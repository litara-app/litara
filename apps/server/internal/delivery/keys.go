// Package delivery implements explicit email delivery of original files
// (ADR-0074): administrator and personal SMTP transports, owner-private
// recipients, an immutable send intent, a durable attempt ledger, and an honest
// outcome_unknown state. SMTP "accepted" means the next server took
// responsibility, never that a message reached an inbox.
package delivery

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

// KeyRing is the operator-supplied, versioned secret-encryption key set. It is
// independent of every login/session secret (ADR-0074). Active seals new
// secrets; older IDs stay readable until the operator retires them.
type KeyRing struct {
	Active string
	Keys   map[string][]byte
}

// ParseKeyRing parses "id:base64key,id2:base64key" (each key exactly 32 bytes).
// An empty spec yields an empty ring: secrets cannot be stored or read, and
// sends that need one fail closed without touching stored data.
func ParseKeyRing(spec, active string) (*KeyRing, error) {
	r := &KeyRing{Active: strings.TrimSpace(active), Keys: map[string][]byte{}}
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, enc, ok := strings.Cut(part, ":")
		id = strings.TrimSpace(id)
		if !ok || id == "" || len(id) > 64 || strings.ContainsAny(id, "|\r\n") {
			return nil, errors.New("SMTP key ring entries must look like id:base64key")
		}
		b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(enc))
		if err != nil || len(b) != 32 {
			return nil, fmt.Errorf("SMTP key %q must be 32 bytes, base64 encoded", id)
		}
		if _, dup := r.Keys[id]; dup {
			return nil, fmt.Errorf("SMTP key %q is listed twice", id)
		}
		r.Keys[id] = b
	}
	if r.Active != "" {
		if _, ok := r.Keys[r.Active]; !ok {
			return nil, fmt.Errorf("active SMTP key %q is not in the key ring", r.Active)
		}
	}
	return r, nil
}

// Available reports whether a new secret can be sealed.
func (k *KeyRing) Available() bool {
	return k != nil && k.Active != "" && len(k.Keys[k.Active]) == 32
}

// Has reports whether the named key can be used to open a stored secret.
func (k *KeyRing) Has(id string) bool { return k != nil && len(k.Keys[id]) == 32 }

func aad(ownerKind, ownerID, keyID string) []byte {
	return []byte("litara-smtp-v1|" + ownerKind + "|" + ownerID + "|" + keyID)
}

// Seal encrypts plaintext bound to its owner, returning the key ID, a fresh
// 96-bit random nonce and the ciphertext. Uniqueness of (key ID, nonce) is
// additionally enforced by a database index.
func (k *KeyRing) Seal(plaintext []byte, ownerKind, ownerID string) (keyID string, nonce, ct []byte, err error) {
	if !k.Available() {
		return "", nil, nil, errors.New("no active SMTP key")
	}
	gcm, err := newGCM(k.Keys[k.Active])
	if err != nil {
		return "", nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", nil, nil, err
	}
	return k.Active, nonce, gcm.Seal(nil, nonce, plaintext, aad(ownerKind, ownerID, k.Active)), nil
}

// Open decrypts a stored secret. A missing or wrong key is an error and never
// alters the stored record.
func (k *KeyRing) Open(keyID string, nonce, ct []byte, ownerKind, ownerID string) ([]byte, error) {
	if !k.Has(keyID) {
		return nil, errors.New("SMTP key unavailable")
	}
	gcm, err := newGCM(k.Keys[keyID])
	if err != nil {
		return nil, err
	}
	if len(nonce) != gcm.NonceSize() {
		return nil, errors.New("invalid nonce")
	}
	return gcm.Open(nil, nonce, ct, aad(ownerKind, ownerID, keyID))
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
