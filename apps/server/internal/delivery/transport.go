package delivery

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"time"
)

// TLS modes (ADR-0074). Plaintext exists only for an explicit local test sink.
const (
	TLSStartTLS  = "starttls"
	TLSImplicit  = "implicit"
	TLSLocalTest = "local_test_plain"
)

// Config is a decrypted transport configuration. It is never logged or stored.
type Config struct {
	Host     string
	Port     int
	TLSMode  string
	Username string
	Password string
	From     string
}

// NetPolicy controls where connections may go and which roots verify them.
type NetPolicy struct {
	// AllowLocalTest permits the plaintext local-test mode and loopback targets
	// for personal transports. Never enable it in production.
	AllowLocalTest bool
	// RootCAs overrides the system roots (tests supply their sink's CA).
	RootCAs *x509.CertPool
	// Resolve overrides DNS (tests). Nil uses the system resolver.
	Resolve func(ctx context.Context, host string) ([]net.IP, error)
	// ConnectTimeout and SendTimeout bound a connection test and a message.
	ConnectTimeout time.Duration
	SendTimeout    time.Duration
}

func (n NetPolicy) connectTimeout() time.Duration {
	if n.ConnectTimeout > 0 {
		return n.ConnectTimeout
	}
	return 15 * time.Second
}

func (n NetPolicy) sendTimeout() time.Duration {
	if n.SendTimeout > 0 {
		return n.SendTimeout
	}
	return 5 * time.Minute
}

// PublicIP reports whether ip is an ordinary public address. Loopback, private,
// link-local (including the 169.254.169.254 metadata address), carrier-grade NAT,
// unspecified and multicast targets are not.
func PublicIP(ip net.IP) bool {
	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
		if ip4[0] == 100 && ip4[1]&0xc0 == 64 { // 100.64.0.0/10
			return false
		}
		if ip4[0] == 0 || ip4[0] >= 240 {
			return false
		}
	}
	return !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast())
}

// ErrNotPermitted is returned when a restricted target resolves to a non-public address.
var ErrNotPermitted = errors.New("address not permitted")

// resolve returns the addresses a connection may use. For a restricted
// (personal) transport every resolved address must be public; the dial then
// uses one of those exact IPs, so a DNS answer cannot change between the check
// and the connection (rebinding).
func (n NetPolicy) resolve(ctx context.Context, host string, restricted bool) ([]net.IP, error) {
	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else if n.Resolve != nil {
		var err error
		if ips, err = n.Resolve(ctx, host); err != nil {
			return nil, err
		}
	} else {
		var err error
		if ips, err = net.DefaultResolver.LookupIP(ctx, "ip", host); err != nil {
			return nil, err
		}
	}
	if len(ips) == 0 {
		return nil, errors.New("host did not resolve")
	}
	if restricted {
		for _, ip := range ips {
			if PublicIP(ip) {
				continue
			}
			if n.AllowLocalTest && ip.IsLoopback() {
				continue
			}
			return nil, ErrNotPermitted
		}
	}
	return ips, nil
}

func (n NetPolicy) tlsConfig(host string) *tls.Config {
	return &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12, RootCAs: n.RootCAs}
}

// Kind classifies a failure for the attempt ledger.
type Kind int

const (
	KindTransient Kind = iota // known not submitted; retry is safe
	KindPermanent             // known refusal or unusable configuration
	KindUnknown               // at or after the submission boundary with no definite answer
)

// Failure is a sanitized transport failure: only a stable code leaves this
// package, never server text, addresses or credentials.
type Failure struct {
	Kind Kind
	Code string
}

func (f *Failure) Error() string { return f.Code }

func classify(err error) *Failure {
	var te *textproto.Error
	if errors.As(err, &te) {
		switch {
		case te.Code == 535 || te.Code == 534 || te.Code == 530:
			return &Failure{KindPermanent, "authentication_failed"}
		case te.Code >= 400 && te.Code < 500:
			return &Failure{KindTransient, "smtp_temporary_" + strconv.Itoa(te.Code)}
		default:
			return &Failure{KindPermanent, "smtp_rejected_" + strconv.Itoa(te.Code)}
		}
	}
	var ua x509.UnknownAuthorityError
	var hn x509.HostnameError
	var ci x509.CertificateInvalidError
	var cv *tls.CertificateVerificationError
	if errors.As(err, &ua) || errors.As(err, &hn) || errors.As(err, &ci) || errors.As(err, &cv) {
		return &Failure{KindPermanent, "tls_verification_failed"}
	}
	if errors.Is(err, ErrNotPermitted) {
		return &Failure{KindPermanent, "address_not_permitted"}
	}
	return &Failure{KindTransient, "connection_failed"}
}

type session struct {
	c    *smtp.Client
	conn net.Conn
}

func (s *session) abort() { _ = s.conn.Close() }

// connect dials, secures and authenticates. It never downgrades: STARTTLS must be
// advertised in starttls mode, and certificates are always verified in the TLS modes.
func (n NetPolicy) connect(ctx context.Context, cfg Config, restricted bool, deadline time.Duration) (*session, *Failure) {
	if cfg.TLSMode == TLSLocalTest && !n.AllowLocalTest {
		return nil, &Failure{KindPermanent, "plaintext_not_permitted"}
	}
	ips, err := n.resolve(ctx, cfg.Host, restricted)
	if err != nil {
		if errors.Is(err, ErrNotPermitted) {
			return nil, &Failure{KindPermanent, "address_not_permitted"}
		}
		return nil, &Failure{KindTransient, "connection_failed"}
	}
	d := net.Dialer{Timeout: n.connectTimeout()}
	var conn net.Conn
	for _, ip := range ips {
		conn, err = d.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), strconv.Itoa(cfg.Port)))
		if err == nil {
			break
		}
	}
	if err != nil {
		return nil, &Failure{KindTransient, "connection_failed"}
	}
	_ = conn.SetDeadline(time.Now().Add(deadline))
	if cfg.TLSMode == TLSImplicit {
		tc := tls.Client(conn, n.tlsConfig(cfg.Host))
		if err := tc.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, classify(err)
		}
		conn = tc
	}
	c, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		_ = conn.Close()
		return nil, classify(err)
	}
	s := &session{c: c, conn: conn}
	if err := c.Hello("litara.invalid"); err != nil {
		s.abort()
		return nil, classify(err)
	}
	if cfg.TLSMode == TLSStartTLS {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			s.abort()
			return nil, &Failure{KindPermanent, "starttls_unavailable"} // never fall back to plaintext
		}
		if err := c.StartTLS(n.tlsConfig(cfg.Host)); err != nil {
			s.abort()
			return nil, classify(err)
		}
	}
	if cfg.Username != "" {
		if ok, _ := c.Extension("AUTH"); !ok {
			s.abort()
			return nil, &Failure{KindPermanent, "authentication_unsupported"}
		}
		if err := c.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			s.abort()
			return nil, classify(err)
		}
	}
	return s, nil
}

// Test connects, secures and authenticates, then quits. It sends no message.
func (n NetPolicy) Test(ctx context.Context, cfg Config, restricted bool) *Failure {
	s, f := n.connect(ctx, cfg, restricted, n.connectTimeout())
	if f != nil {
		return f
	}
	_ = s.c.Quit()
	_ = s.conn.Close()
	return nil
}

// SendHooks are test seams for failure injection.
type SendHooks struct {
	// AfterBoundary runs after the durable boundary is recorded and before any
	// message byte is written. Returning an error abandons the connection, which
	// models a crash at the worst moment.
	AfterBoundary func() error
}

// Send submits one message. boundary must durably record that the DATA phase is
// about to start; if it fails nothing has been sent and the result is transient.
// Everything at or after the boundary that lacks a definite SMTP answer is
// KindUnknown: the caller must never resend automatically.
func (n NetPolicy) Send(ctx context.Context, cfg Config, restricted bool, to mail.Address, msg *Message, boundary func() error, hooks SendHooks) *Failure {
	s, f := n.connect(ctx, cfg, restricted, n.sendTimeout())
	if f != nil {
		return f
	}
	if err := s.c.Mail(cfg.From); err != nil {
		s.abort()
		return classify(err)
	}
	if err := s.c.Rcpt(to.Address); err != nil {
		s.abort()
		return classify(err)
	}
	w, err := s.c.Data()
	if err != nil {
		s.abort()
		return classify(err)
	}
	// Boundary: from here a lost connection means the message may have been accepted.
	if err := boundary(); err != nil {
		s.abort()
		return &Failure{KindTransient, "boundary_unavailable"}
	}
	if hooks.AfterBoundary != nil {
		if err := hooks.AfterBoundary(); err != nil {
			s.abort()
			return &Failure{KindUnknown, "attempt_interrupted"}
		}
	}
	if err := msg.Render(w); err != nil {
		s.abort()
		return &Failure{KindUnknown, "submission_interrupted"}
	}
	if err := w.Close(); err != nil {
		s.abort()
		var te *textproto.Error
		if errors.As(err, &te) { // a definite refusal after the terminator: not accepted
			if te.Code >= 500 {
				return &Failure{KindPermanent, "smtp_rejected_after_data"}
			}
			return &Failure{KindPermanent, "smtp_deferred_after_data"}
		}
		return &Failure{KindUnknown, "acknowledgement_lost"}
	}
	_ = s.c.Quit()
	_ = s.conn.Close()
	return nil
}
