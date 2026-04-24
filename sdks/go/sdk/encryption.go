package sdk

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
)

// RecipientPayload is the plaintext struct encrypted into the on-chain
// `messageHash`. Field names + order match the aggregator's
// `crypto.EncryptOrderRecipient` struct exactly.
type RecipientPayload struct {
	Nonce             string                 `json:"Nonce"`
	AccountIdentifier string                 `json:"AccountIdentifier"`
	AccountName       string                 `json:"AccountName"`
	Institution       string                 `json:"Institution"`
	ProviderID        string                 `json:"ProviderID"`
	Memo              string                 `json:"Memo"`
	Metadata          map[string]interface{} `json:"Metadata"`
}

// BuildRecipientPayload fills in a RecipientPayload with a fresh random
// nonce. Aggregator-side nonce semantics are preserved (12 random bytes,
// base64).
func BuildRecipientPayload(
	institution, accountIdentifier, accountName, memo, providerID string,
	metadata map[string]interface{},
) (RecipientPayload, error) {
	nonceBytes := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, nonceBytes); err != nil {
		return RecipientPayload{}, fmt.Errorf("failed to generate nonce: %w", err)
	}
	return RecipientPayload{
		Nonce:             base64.StdEncoding.EncodeToString(nonceBytes),
		AccountIdentifier: accountIdentifier,
		AccountName:       accountName,
		Institution:       institution,
		ProviderID:        providerID,
		Memo:              memo,
		Metadata:          metadata,
	}, nil
}

// EncryptRecipientPayload produces the base64-encoded hybrid envelope
// the Gateway contract expects. Byte-for-byte identical to
// `aggregator/utils/crypto/crypto.go::encryptHybridJSON`.
//
// Envelope layout:
//
//	[4 bytes BE: encrypted-AES-key length]
//	[encrypted-AES-key bytes]
//	[12-byte AES-GCM nonce]
//	[AES-GCM ciphertext]
//	[16-byte AES-GCM auth tag]
func EncryptRecipientPayload(payload RecipientPayload, publicKeyPEM string) (string, error) {
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}

	aesKey := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, aesKey); err != nil {
		return "", fmt.Errorf("generate aes key: %w", err)
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return "", fmt.Errorf("aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("aes-gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate aes nonce: %w", err)
	}
	aesCiphertext := gcm.Seal(nonce, nonce, plaintext, nil)

	encryptedKey, err := rsaEncrypt(aesKey, publicKeyPEM)
	if err != nil {
		return "", err
	}

	result := make([]byte, 4+len(encryptedKey)+len(aesCiphertext))
	binary.BigEndian.PutUint32(result[0:4], uint32(len(encryptedKey)))
	copy(result[4:], encryptedKey)
	copy(result[4+len(encryptedKey):], aesCiphertext)

	return base64.StdEncoding.EncodeToString(result), nil
}

func rsaEncrypt(plaintext []byte, publicKeyPEM string) ([]byte, error) {
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return nil, fmt.Errorf("failed to parse PEM block")
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse public key: %w", err)
	}
	rsaKey, ok := pub.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("public key is not RSA (got %T)", pub)
	}
	return rsa.EncryptPKCS1v15(rand.Reader, rsaKey, plaintext)
}
