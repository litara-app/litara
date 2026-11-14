package accounts

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/text/unicode/norm"
)

// ArgonParams are the argon2id work factors. They are configurable
// (LITARA_ARGON2_*) because the right values depend on the host; the
// defaults follow the OWASP Password Storage guidance (m>=19 MiB, t>=2, p=1)
// with extra headroom.
type ArgonParams struct {
	MemoryKiB uint32
	Time      uint32
	Threads   uint8
}

// DefaultArgon is used when no override is configured.
var DefaultArgon = ArgonParams{MemoryKiB: 64 * 1024, Time: 3, Threads: 2}

const argonKeyLen = 32

// HashPassword returns a PHC-style argon2id string. Passwords are never normalized.
func HashPassword(password string, p ArgonParams) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, p.Time, p.MemoryKiB, p.Threads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, p.MemoryKiB, p.Time, p.Threads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword checks password against an encoded hash in constant time.
func VerifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	var p ArgonParams
	var threads uint
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.MemoryKiB, &p.Time, &threads); err != nil {
		return false
	}
	p.Threads = uint8(threads)
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, p.Time, p.MemoryKiB, p.Threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// dummyHash lets unknown usernames cost the same as wrong passwords.
var dummyHash string

func init() {
	dummyHash, _ = HashPassword("dummy-password-for-timing", ArgonParams{MemoryKiB: 8, Time: 1, Threads: 1})
}

// NormalizeUsername returns the uniqueness key: trimmed, Unicode NFC, lowercase.
func NormalizeUsername(name string) string {
	return norm.NFC.String(strings.ToLower(norm.NFC.String(strings.TrimSpace(name))))
}

// NewToken returns a random opaque token and its SHA-256 verifier.
func NewToken() (token string, verifier []byte, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashToken(token), nil
}

// HashToken is the stored verifier of a token (high entropy, so plain SHA-256 suffices).
func HashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// CSRFFor derives the session-bound CSRF token from the cookie token.
func CSRFFor(cookieToken string) string {
	h := sha256.Sum256([]byte("litara-csrf-v1:" + cookieToken))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// ValidCSRF compares a presented CSRF value in constant time.
func ValidCSRF(cookieToken, presented string) bool {
	return subtle.ConstantTimeCompare([]byte(CSRFFor(cookieToken)), []byte(presented)) == 1
}

// ParseKey decodes a base64 secret key of exactly 32 bytes.
func ParseKey(s string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(s))
	if err != nil {
		b, err = base64.RawStdEncoding.DecodeString(strings.TrimSpace(s))
	}
	if err != nil || len(b) != 32 {
		return nil, errors.New("secret key must be 32 bytes, base64 encoded")
	}
	return b, nil
}

// GenerateKey returns a fresh base64 secret key.
func GenerateKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

func seal(key, plaintext, aad []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, aad), nil
}

func open(key, sealed, aad []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("sealed value too short")
	}
	return gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], aad)
}
