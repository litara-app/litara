// Command tlsproxy is a disposable TLS-terminating reverse proxy for the T007 two-origin rehearsal (stdlib only).
//
//	go run main.go -out DIR -listen 127.0.0.1:18443 -app app.litara.test=127.0.0.1:18407 -reader reader.litara.test=127.0.0.1:18409
//
// It creates a throwaway CA and a leaf certificate for both host names (written to DIR/ca.pem; the private keys stay in
// memory), then serves HTTPS on one port and routes by the TLS server name / Host header. It sets X-Forwarded-Proto: https.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	out := flag.String("out", ".", "directory for ca.pem")
	listen := flag.String("listen", "127.0.0.1:18443", "HTTPS listen address")
	app := flag.String("app", "", "host=backend for the application origin")
	reader := flag.String("reader", "", "host=backend for the reader origin")
	ips := flag.String("ip", "", "comma-separated IP addresses to add as certificate SANs (for clients that connect by address)")
	def := flag.String("default", "", "host=backend used for any other Host header (for example an IP literal)")
	flag.Parse()
	routes := map[string]*httputil.ReverseProxy{}
	var names []string
	var fallback *httputil.ReverseProxy
	for _, kv := range []string{*app, *reader} {
		if kv == "" {
			continue
		}
		host, backend, ok := strings.Cut(kv, "=")
		if !ok {
			log.Fatal("need host=backend")
		}
		u, _ := url.Parse("http://" + backend)
		rp := httputil.NewSingleHostReverseProxy(u)
		d := rp.Director
		rp.Director = func(r *http.Request) { h := r.Host; d(r); r.Host = h; r.Header.Set("X-Forwarded-Proto", "https") }
		routes[host] = rp
		names = append(names, host)
		if *def != "" && *def == kv {
			fallback = rp
		}
	}
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	caTmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "T007 rehearsal CA"}, NotBefore: time.Now().Add(-time.Hour),
		NotAfter: time.Now().Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, _ := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	caCert, _ := x509.ParseCertificate(caDER)
	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	var ipAddrs []net.IP
	for _, a := range strings.Split(*ips, ",") {
		if ip := net.ParseIP(strings.TrimSpace(a)); ip != nil {
			ipAddrs = append(ipAddrs, ip)
		}
	}
	leafTmpl := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: names[0]}, DNSNames: names, IPAddresses: ipAddrs, NotBefore: time.Now().Add(-time.Hour),
		NotAfter: time.Now().Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, _ := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	if err := os.WriteFile(filepath.Join(*out, "ca.pem"), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), 0o644); err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{Addr: *listen, ReadHeaderTimeout: 10 * time.Second,
		TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{leafDER}, PrivateKey: leafKey}}},
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := strings.ToLower(strings.Split(r.Host, ":")[0])
			rp, ok := routes[host]
			if !ok && fallback != nil {
				rp, ok = fallback, true
			}
			if !ok {
				http.Error(w, "unknown host", http.StatusMisdirectedRequest)
				return
			}
			rp.ServeHTTP(w, r)
		})}
	fmt.Println("tlsproxy listening on", *listen, "for", names)
	log.Fatal(srv.ListenAndServeTLS("", ""))
}
