// Package smtptest is a local SMTP sink for tests. It listens on loopback only,
// records what it receives, and can be scripted to refuse recipients, reject or
// defer DATA, and accept a message but drop the connection before replying
// (a lost acknowledgement). It is test infrastructure: no real mail is sent.
package smtptest

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// CA signs the sink's certificate. A client trusts a sink only if its pool holds that CA.
type CA struct {
	Cert *x509.Certificate
	key  *ecdsa.PrivateKey
	Pool *x509.CertPool
}

func NewCA(t testing.TB) *CA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "Litara test CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return &CA{Cert: cert, key: key, Pool: pool}
}

func (c *CA) leaf(t testing.TB) tls.Certificate {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "localhost"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, c.Cert, &key.PublicKey, c.key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

// Mode selects the transport security the sink offers.
type Mode int

const (
	Plain      Mode = iota // no TLS at all
	StartTLS               // STARTTLS offered
	Implicit               // TLS from the first byte
	NoSTARTTLS             // TLS-capable server that does not advertise STARTTLS
)

// Behavior scripts the sink. Every hook is optional.
type Behavior struct {
	// RejectRcpt returns a reply code (0 = accept) for a recipient.
	RejectRcpt func(addr string) (int, string)
	// DataReply replaces the reply to the DATA command (0 = 354).
	DataReply int
	// FinalReply replaces the reply after the message terminator (0 = 250).
	FinalReply int
	// DropAfterData accepts and records the message, then closes the connection without any reply.
	DropAfterData bool
	// Auth, when set, requires AUTH PLAIN with these credentials before MAIL.
	AuthUser, AuthPass string
	// ConnectReply replaces the 220 greeting, for example "421 busy".
	ConnectReply string
}

// Message is one message the sink received.
type Message struct {
	From string
	To   []string
	Raw  []byte
}

// Server is a running sink.
type Server struct {
	Host string
	Port int
	ln   net.Listener
	mode Mode
	b    Behavior
	cfg  *tls.Config

	mu          sync.Mutex
	Messages    []Message
	Connections int
	DataStarted int
}

// Start listens on a random loopback port. ca may be nil for Plain mode.
func Start(t testing.TB, mode Mode, ca *CA, b Behavior) *Server {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port, ln: ln, mode: mode, b: b}
	if ca != nil {
		s.cfg = &tls.Config{Certificates: []tls.Certificate{ca.leaf(t)}, MinVersion: tls.VersionTLS12}
	}
	go s.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return s
}

// Received returns a copy of the recorded messages.
func (s *Server) Received() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Message(nil), s.Messages...)
}

// Counts returns how many connections and DATA phases were seen.
func (s *Server) Counts() (conns, data int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Connections, s.DataStarted
}

func (s *Server) serve() {
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		s.Connections++
		s.mu.Unlock()
		go s.handle(c)
	}
}

type conn struct {
	net.Conn
	r *bufio.Reader
}

func (s *Server) handle(raw net.Conn) {
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(30 * time.Second))
	if s.mode == Implicit {
		tc := tls.Server(raw, s.cfg)
		if err := tc.Handshake(); err != nil {
			return
		}
		raw = tc
	}
	c := &conn{Conn: raw, r: bufio.NewReader(raw)}
	if s.b.ConnectReply != "" {
		c.say(s.b.ConnectReply)
		return
	}
	c.say("220 sink ESMTP")
	secure := s.mode == Implicit
	authed := s.b.AuthUser == ""
	var from string
	var rcpts []string
	for {
		line, err := c.r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		verb := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(verb, "EHLO"), strings.HasPrefix(verb, "HELO"):
			c.say("250-sink")
			if s.mode == StartTLS && !secure {
				c.say("250-STARTTLS")
			}
			if s.b.AuthUser != "" && (secure || s.mode == Plain) {
				c.say("250-AUTH PLAIN")
			}
			c.say("250 8BITMIME")
		case verb == "STARTTLS":
			if s.mode != StartTLS || secure {
				c.say("503 not available")
				continue
			}
			c.say("220 ready")
			tc := tls.Server(raw, s.cfg)
			if err := tc.Handshake(); err != nil {
				return
			}
			raw, secure = tc, true
			c = &conn{Conn: raw, r: bufio.NewReader(raw)}
			from, rcpts = "", nil
		case strings.HasPrefix(verb, "AUTH PLAIN"):
			fields := strings.Fields(line)
			if len(fields) < 3 {
				c.say("501 initial response required")
				continue
			}
			dec, err := base64.StdEncoding.DecodeString(fields[2])
			parts := strings.Split(string(dec), "\x00")
			if err != nil || len(parts) != 3 || parts[1] != s.b.AuthUser || parts[2] != s.b.AuthPass {
				c.say("535 5.7.8 authentication failed")
				continue
			}
			authed = true
			c.say("235 2.7.0 ok")
		case strings.HasPrefix(verb, "MAIL FROM:"):
			if !authed {
				c.say("530 5.7.0 authentication required")
				continue
			}
			from = angle(line[len("MAIL FROM:"):])
			c.say("250 ok")
		case strings.HasPrefix(verb, "RCPT TO:"):
			addr := angle(line[len("RCPT TO:"):])
			if s.b.RejectRcpt != nil {
				if code, text := s.b.RejectRcpt(addr); code != 0 {
					c.say(fmt.Sprintf("%d %s", code, text))
					continue
				}
			}
			rcpts = append(rcpts, addr)
			c.say("250 ok")
		case verb == "DATA":
			if s.b.DataReply != 0 {
				c.say(fmt.Sprintf("%d data refused", s.b.DataReply))
				continue
			}
			c.say("354 go ahead")
			s.mu.Lock()
			s.DataStarted++
			s.mu.Unlock()
			body, err := readData(c.r)
			if err != nil {
				return
			}
			s.mu.Lock()
			s.Messages = append(s.Messages, Message{From: from, To: append([]string(nil), rcpts...), Raw: body})
			s.mu.Unlock()
			if s.b.DropAfterData {
				return // accepted and recorded, but the client never learns it
			}
			if s.b.FinalReply != 0 {
				c.say(fmt.Sprintf("%d final reply", s.b.FinalReply))
			} else {
				c.say("250 2.0.0 queued")
			}
			from, rcpts = "", nil
		case verb == "RSET", verb == "NOOP":
			c.say("250 ok")
		case verb == "QUIT":
			c.say("221 bye")
			return
		default:
			c.say("502 not implemented")
		}
	}
}

func (c *conn) say(s string) { _, _ = c.Write([]byte(s + "\r\n")) }

// readData reads until the lone "." line, undoing dot-stuffing.
func readData(r *bufio.Reader) ([]byte, error) {
	var out []byte
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		if line == ".\r\n" || line == ".\n" {
			return out, nil
		}
		if strings.HasPrefix(line, "..") {
			line = line[1:]
		}
		out = append(out, line...)
	}
}

// angle extracts the address inside <...>, ignoring ESMTP parameters after it.
func angle(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "<"); i >= 0 {
		if j := strings.Index(s[i:], ">"); j > 0 {
			return s[i+1 : i+j]
		}
	}
	return s
}
