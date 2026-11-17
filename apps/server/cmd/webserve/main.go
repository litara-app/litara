// Command webserve serves a built web directory on two origins with the
// production handlers and headers, without a database (ADR-0071). It exists
// for local browser isolation tests only; it is not a deployment entry point.
package main

import (
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/webui"
)

func main() {
	dir := flag.String("dir", "../web/dist", "built web directory")
	appAddr := flag.String("addr", "127.0.0.1:8099", "application listen address")
	readerAddr := flag.String("reader-addr", "127.0.0.1:8098", "reader listen address")
	appOrigin := flag.String("app-origin", "http://127.0.0.1:8099", "public application origin")
	readerOrigin := flag.String("reader-origin", "http://localhost:8098", "public reader origin (different hostname)")
	flag.Parse()
	o := webui.Origins{App: *appOrigin, Reader: *readerOrigin}
	root := os.DirFS(*dir)
	sub, err := fs.Sub(root, "reader")
	if err != nil {
		log.Fatal(err)
	}
	reader := &http.Server{Addr: *readerAddr, Handler: webui.Reader(sub, o), ReadHeaderTimeout: 10 * time.Second}
	go func() { log.Fatal(reader.ListenAndServe()) }()
	app := &http.Server{Addr: *appAddr, Handler: webui.App(root, o), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(app.ListenAndServe())
}
