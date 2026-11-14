// Command webserve serves a built web directory with the production web
// handler and headers, without a database. It exists for local browser
// isolation tests only; it is not a deployment entry point.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/webui"
)

func main() {
	dir := flag.String("dir", "../web/dist", "built web directory")
	addr := flag.String("addr", "127.0.0.1:8099", "listen address")
	flag.Parse()
	srv := &http.Server{Addr: *addr, Handler: webui.Handler(os.DirFS(*dir)), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
