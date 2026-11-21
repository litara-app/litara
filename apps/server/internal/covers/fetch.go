package covers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"time"
)

const (
	maxRedirects = 3
	fetchTimeout = 10 * time.Second
)

// ErrForbiddenAddress is returned when a URL names, or resolves to, an address the server will not contact.
var ErrForbiddenAddress = errors.New("that address is not allowed: only public internet addresses can be fetched")

// Fetcher downloads one image from a public address. The address check runs when the connection is made, on the
// resolved IP, so it also covers redirects and a hostname that resolves differently the second time.
type Fetcher struct {
	client *http.Client
}

// NewFetcher returns a Fetcher. allowPrivate is for tests that serve from a loopback address; production passes false.
func NewFetcher(allowPrivate bool) *Fetcher {
	dialer := &net.Dialer{Timeout: fetchTimeout}
	tr := &http.Transport{
		Proxy:               nil, // never through an environment proxy: the address check must see the real destination
		DisableKeepAlives:   true,
		TLSHandshakeTimeout: fetchTimeout,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			for _, ip := range ips {
				if !allowPrivate && !publicIP(ip) {
					return nil, ErrForbiddenAddress
				}
			}
			if len(ips) == 0 {
				return nil, ErrForbiddenAddress
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
		},
	}
	return &Fetcher{client: &http.Client{
		Transport: tr,
		Timeout:   fetchTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return fmt.Errorf("more than %d redirects", maxRedirects)
			}
			return checkScheme(req.URL)
		},
	}}
}

func checkScheme(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrForbiddenAddress
	}
	if u.User != nil || u.Hostname() == "" {
		return ErrForbiddenAddress
	}
	return nil
}

// publicIP reports whether ip is a routable public address. Loopback, private, link-local (including cloud metadata),
// unspecified, multicast and carrier-grade NAT ranges are all refused.
func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	if cgnat := netip.MustParsePrefix("100.64.0.0/10"); cgnat.Contains(ip) {
		return false
	}
	return true
}

// Get fetches rawURL and returns the normalized cover. The declared content type is ignored; the bytes decide.
func (f *Fetcher) Get(ctx context.Context, rawURL string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil || checkScheme(u) != nil {
		return nil, ErrForbiddenAddress
	}
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, ErrForbiddenAddress
	}
	req.Header.Set("Accept", "image/jpeg,image/png,image/webp")
	req.Header.Set("User-Agent", "Litara-cover-fetch")
	resp, err := f.client.Do(req)
	if err != nil {
		if errors.Is(err, ErrForbiddenAddress) {
			return nil, ErrForbiddenAddress
		}
		return nil, fmt.Errorf("could not fetch the image: %w", errors.Unwrap(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the site answered %d", resp.StatusCode)
	}
	if resp.ContentLength > MaxBytes {
		return nil, ErrTooLarge
	}
	return Normalize(io.LimitReader(resp.Body, MaxBytes+1))
}
