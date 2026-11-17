package delivery

import (
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net/mail"
	"strings"
	"time"
)

// Message is one email with exactly one original attachment. The attachment is
// streamed from the file, never buffered whole, and never converted.
type Message struct {
	From, To  mail.Address
	Filename  string
	MIME      string
	Body      io.Reader // the attachment bytes
	MessageID string
	Date      time.Time
	Boundary  string
}

// SafeFilename removes anything that could break header syntax or paths.
func SafeFilename(name string) string {
	clean := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\\' || r == '/' || r == ':' {
			return '_'
		}
		return r
	}, name)
	clean = strings.TrimSpace(clean)
	if clean == "" || clean == "." || clean == ".." {
		return "attachment"
	}
	if len(clean) > 200 {
		clean = clean[:200]
	}
	return clean
}

// ValidMailbox rejects anything but a bare, single, header-safe address.
func ValidMailbox(addr string) (string, bool) {
	if addr == "" || len(addr) > 320 || strings.ContainsAny(addr, "\r\n\x00") {
		return "", false
	}
	a, err := mail.ParseAddress(addr)
	if err != nil || a.Name != "" || a.Address != addr || strings.ContainsAny(addr, " ,;<>") {
		return "", false
	}
	return a.Address, true
}

// lineWrapper wraps base64 output at 76 columns with CRLF.
type lineWrapper struct {
	w   io.Writer
	col int
	err error
}

func (l *lineWrapper) Write(p []byte) (int, error) {
	for _, b := range p {
		if l.err != nil {
			return 0, l.err
		}
		if l.col == 76 {
			_, l.err = l.w.Write([]byte("\r\n"))
			l.col = 0
		}
		_, l.err = l.w.Write([]byte{b})
		l.col++
	}
	return len(p), l.err
}

// Render renders the RFC 5322 message with CRLF line ends. Every header value
// that came from a person is encoded or pre-validated, so no field can inject a
// header (CR/LF are impossible after SafeFilename and ValidMailbox).
func (m *Message) Render(w io.Writer) error {
	h := func(k, v string) error { _, err := fmt.Fprintf(w, "%s: %s\r\n", k, v); return err }
	disp := mime.FormatMediaType("attachment", map[string]string{"filename": m.Filename})
	ctype := mime.FormatMediaType(m.MIME, map[string]string{"name": m.Filename})
	if disp == "" || ctype == "" {
		return fmt.Errorf("unencodable attachment name")
	}
	for _, kv := range [][2]string{
		{"From", m.From.String()}, {"To", m.To.String()},
		{"Subject", mime.QEncoding.Encode("utf-8", "Litara: "+m.Filename)},
		{"Date", m.Date.UTC().Format(time.RFC1123Z)}, {"Message-ID", "<" + m.MessageID + ">"},
		{"MIME-Version", "1.0"}, {"Content-Type", "multipart/mixed; boundary=" + m.Boundary},
	} {
		if err := h(kv[0], kv[1]); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(w, "\r\n--%s\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\nAn original file from your Litara library is attached. No conversion was applied.\r\n", m.Boundary); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "--%s\r\nContent-Type: %s\r\nContent-Disposition: %s\r\nContent-Transfer-Encoding: base64\r\n\r\n", m.Boundary, ctype, disp); err != nil {
		return err
	}
	lw := &lineWrapper{w: w}
	enc := base64.NewEncoder(base64.StdEncoding, lw)
	if _, err := io.Copy(enc, m.Body); err != nil {
		return err
	}
	if err := enc.Close(); err != nil {
		return err
	}
	_, err := fmt.Fprintf(w, "\r\n--%s--\r\n", m.Boundary)
	return err
}
