package delivery

import (
	"bytes"
	"context"
	"encoding/base64"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"
)

func TestPublicIPClassification(t *testing.T) {
	for ip, want := range map[string]bool{
		"8.8.8.8": true, "93.184.216.34": true, "2606:4700:4700::1111": true,
		"127.0.0.1": false, "::1": false, "10.0.0.5": false, "172.16.9.1": false, "192.168.1.1": false,
		"169.254.169.254": false, "fe80::1": false, "100.64.0.1": false, "0.0.0.0": false, "224.0.0.1": false,
		"fd00::1": false, "::ffff:10.0.0.1": false, "255.255.255.255": false,
	} {
		if got := PublicIP(net.ParseIP(ip)); got != want {
			t.Errorf("PublicIP(%s) = %v, want %v", ip, got, want)
		}
	}
}

func TestRestrictedResolutionRejectsAnyNonPublicAnswer(t *testing.T) {
	answers := map[string][]net.IP{
		"public.example":  {net.ParseIP("93.184.216.34")},
		"private.example": {net.ParseIP("10.0.0.5")},
		"mixed.example":   {net.ParseIP("93.184.216.34"), net.ParseIP("169.254.169.254")}, // a rebinding-style answer set
		"meta.example":    {net.ParseIP("169.254.169.254")},
	}
	n := NetPolicy{Resolve: func(_ context.Context, h string) ([]net.IP, error) { return answers[h], nil }}
	for host, ok := range map[string]bool{"public.example": true, "private.example": false, "mixed.example": false, "meta.example": false} {
		_, err := n.resolve(context.Background(), host, true)
		if (err == nil) != ok {
			t.Errorf("restricted %s: err=%v want ok=%v", host, err, ok)
		}
		// An administrator's local relay is not restricted.
		if _, err := n.resolve(context.Background(), host, false); err != nil {
			t.Errorf("unrestricted %s: %v", host, err)
		}
	}
	// Loopback is allowed to a restricted transport only in explicit local-test mode.
	lo := NetPolicy{}
	if _, err := lo.resolve(context.Background(), "127.0.0.1", true); err == nil {
		t.Error("loopback allowed without local-test mode")
	}
	lo.AllowLocalTest = true
	if _, err := lo.resolve(context.Background(), "127.0.0.1", true); err != nil {
		t.Errorf("loopback with local-test mode: %v", err)
	}
	if _, err := lo.resolve(context.Background(), "10.0.0.5", true); err == nil {
		t.Error("private address allowed in local-test mode")
	}
	// The failure is a sanitized permanent code, never a connection attempt.
	f := n.Test(context.Background(), Config{Host: "meta.example", Port: 25, TLSMode: TLSStartTLS}, true)
	if f == nil || f.Code != "address_not_permitted" || f.Kind != KindPermanent {
		t.Errorf("test failure: %+v", f)
	}
	// Plaintext is refused outright outside local-test mode, even for an administrator.
	f = NetPolicy{}.Test(context.Background(), Config{Host: "127.0.0.1", Port: 25, TLSMode: TLSLocalTest}, false)
	if f == nil || f.Code != "plaintext_not_permitted" {
		t.Errorf("plaintext: %+v", f)
	}
}

func TestKeyRingSealOpenAndBinding(t *testing.T) {
	k1 := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))
	k2 := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32))
	ring, err := ParseKeyRing("a:"+k1+", b:"+k2, "a")
	if err != nil || !ring.Available() {
		t.Fatal(err)
	}
	id, nonce, ct, err := ring.Seal([]byte("hunter2-secret"), "personal", "user-1")
	if err != nil || id != "a" || len(nonce) != 12 || bytes.Contains(ct, []byte("hunter2")) {
		t.Fatalf("seal: %v %s %d", err, id, len(nonce))
	}
	if pt, err := ring.Open(id, nonce, ct, "personal", "user-1"); err != nil || string(pt) != "hunter2-secret" {
		t.Fatalf("open: %v %q", err, pt)
	}
	// Bound to its owner: another user, kind or key cannot open it.
	for name, f := range map[string]func() error{
		"other user": func() error { _, e := ring.Open(id, nonce, ct, "personal", "user-2"); return e },
		"other kind": func() error { _, e := ring.Open(id, nonce, ct, "server", "user-1"); return e },
		"other key":  func() error { _, e := ring.Open("b", nonce, ct, "personal", "user-1"); return e },
		"tampered": func() error {
			c := append([]byte(nil), ct...)
			c[0] ^= 1
			_, e := ring.Open(id, nonce, c, "personal", "user-1")
			return e
		},
		"missing key": func() error { _, e := (&KeyRing{}).Open(id, nonce, ct, "personal", "user-1"); return e },
	} {
		if f() == nil {
			t.Errorf("%s opened the secret", name)
		}
	}
	// Fresh nonces: sealing the same plaintext twice never repeats one.
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		_, n, _, _ := ring.Seal([]byte("x"), "personal", "u")
		if seen[string(n)] {
			t.Fatal("nonce reuse")
		}
		seen[string(n)] = true
	}
	for _, bad := range []string{"a", "a:!!", "a:" + base64.StdEncoding.EncodeToString([]byte("short")), "a:" + k1 + ",a:" + k2} {
		if _, err := ParseKeyRing(bad, ""); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if _, err := ParseKeyRing("a:"+k1, "missing"); err == nil {
		t.Error("active key not in ring accepted")
	}
	if (&KeyRing{}).Available() || (*KeyRing)(nil).Available() {
		t.Error("an empty ring must be unavailable")
	}
}

func TestMessageIsHeaderInjectionSafeAndOneAttachment(t *testing.T) {
	name := SafeFilename("evil\r\nBcc: x@y.invalid\r\n.txt")
	if strings.ContainsAny(name, "\r\n") {
		t.Fatalf("filename %q", name)
	}
	if SafeFilename("../../etc/passwd") != ".._.._etc_passwd" || SafeFilename("") != "attachment" || SafeFilename("..") != "attachment" {
		t.Fatal("path/empty handling")
	}
	m := &Message{From: mail.Address{Address: "from@example.invalid"}, To: mail.Address{Name: "Zoë \"Q\" Reader", Address: "to@example.invalid"},
		Filename: name, MIME: "application/octet-stream", Body: bytes.NewReader(bytes.Repeat([]byte{0xff, 0x00, '.', '\r', '\n'}, 400)),
		MessageID: "id@litara.invalid", Boundary: "b-1", Date: time.Unix(0, 0)}
	var buf bytes.Buffer
	if err := m.Render(&buf); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if strings.Count(out, "Content-Disposition: attachment") != 1 || strings.Contains(out, "\nBcc:") || strings.Contains(out, "Bcc: x@y") {
		t.Fatalf("message:\n%s", out)
	}
	for _, line := range strings.Split(out, "\r\n") {
		if len(line) > 998 {
			t.Fatalf("overlong line %d", len(line))
		}
	}
	if strings.Contains(strings.ReplaceAll(out, "\r\n", ""), "\n") {
		t.Fatal("bare newline in message")
	}
	for in, ok := range map[string]bool{"a@example.invalid": true, "": false, "a@b\r\nBcc: c@d": false, "A <a@b.invalid>": false, "a@b.invalid, c@d.invalid": false, "no-at": false, "a b@c.invalid": false} {
		if _, got := ValidMailbox(in); got != ok {
			t.Errorf("ValidMailbox(%q) = %v", in, got)
		}
	}
}
