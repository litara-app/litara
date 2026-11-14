package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/term"

	"github.com/deranjer/ebooker/apps/server/internal/accounts"
	"github.com/deranjer/ebooker/apps/server/internal/app"
	"github.com/deranjer/ebooker/apps/server/internal/config"
	"github.com/deranjer/ebooker/apps/server/internal/db"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
)

// readPassword reads a password from an interactive prompt (no echo) or, when
// stdin is not a terminal, one line from stdin. It never accepts an argument.
func readPassword(prompt string, confirm bool) (string, error) {
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, prompt)
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", err
		}
		if confirm {
			fmt.Fprint(os.Stderr, "Repeat password: ")
			b2, err := term.ReadPassword(fd)
			fmt.Fprintln(os.Stderr)
			if err != nil {
				return "", err
			}
			if string(b) != string(b2) {
				return "", errors.New("passwords do not match")
			}
		}
		return string(b), nil
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && !(errors.Is(err, io.EOF) && line != "") {
		return "", errors.New("no password supplied on stdin")
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func newAccounts(cfg *config.Config, pool *pgxpool.Pool) *accounts.Service {
	return accounts.New(accounts.Options{Pool: pool, Argon: accounts.ArgonParams{MemoryKiB: cfg.ArgonMemoryKiB, Time: cfg.ArgonTime, Threads: cfg.ArgonThreads}})
}

func openapiCmd(out io.Writer) error {
	mux := http.NewServeMux()
	api := httpapi.RegisterAPI(mux, httpapi.APIDeps{})
	b, err := json.MarshalIndent(api.OpenAPI(), "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(out, string(b))
	return err
}

func bootstrapCmd(ctx context.Context, cfg *config.Config, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("bootstrap-admin", flag.ContinueOnError)
	username := fs.String("username", "", "administrator username")
	display := fs.String("display-name", "", "display name (defaults to the username)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*username) == "" {
		return errors.New("usage: ctl bootstrap-admin --username NAME [--display-name TEXT]   (password from prompt or stdin)")
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	pw, err := readPassword("Administrator password (12+ characters): ", true)
	if err != nil {
		return err
	}
	u, err := newAccounts(cfg, pool).Bootstrap(ctx, *username, *display, pw)
	if err != nil {
		if errors.Is(err, accounts.ErrAlreadyInitialized) {
			return errors.New("refused: this server already has users; use the administrator API to create accounts")
		}
		return err
	}
	fmt.Fprintf(out, "created administrator %q (id %s) with no library grants\n", u.Username, u.ID)
	return nil
}

func resetPasswordCmd(ctx context.Context, cfg *config.Config, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("reset-password", flag.ContinueOnError)
	username := fs.String("username", "", "account to reset")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*username) == "" {
		return errors.New("usage: ctl reset-password --username NAME   (password from prompt or stdin)")
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	pw, err := readPassword("New password (12+ characters): ", true)
	if err != nil {
		return err
	}
	if err := newAccounts(cfg, pool).SetPassword(ctx, *username, pw); err != nil {
		return err
	}
	fmt.Fprintf(out, "password updated for %q; all of that user's sessions were revoked\n", *username)
	return nil
}

func seedCmd(ctx context.Context, cfg *config.Config, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("seed", flag.ContinueOnError)
	dir := fs.String("dir", "", "absolute directory for generated fixture media")
	stdin := fs.Bool("password-stdin", false, "read the shared synthetic-account password from stdin (otherwise one is generated and printed once)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *dir == "" {
		return errors.New("usage: ctl seed --dir ABSOLUTE_DIR [--password-stdin]")
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	st, err := db.CheckSchema(ctx, pool)
	if err != nil {
		return err
	}
	if !st.Ready() {
		return errors.New("schema is not current; run `ctl migrate up` first")
	}
	pw := ""
	if *stdin {
		if pw, err = readPassword("Fixture password: ", false); err != nil {
			return err
		}
	}
	fix, err := seed.Run(ctx, seed.Options{Pool: pool, Accounts: newAccounts(cfg, pool), Inspector: app.NewInspector(cfg),
		FFmpeg: cfg.FFmpegPath, Dir: *dir, Password: pw})
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "seeded fixture in %s\n  users: %s (administrator, no grants), %s (library one), %s (library two)\n  recordings: three-file=%s alternate=%s incomplete=%s other-library=%s\n",
		fix.Dir, seed.AdminName, seed.UserAName, seed.UserBName, fix.ThreeFile, fix.Alternate, fix.Incomplete, fix.OtherLibrary)
	if fix.Password != "" {
		fmt.Fprintf(out, "  generated synthetic password (shown once): %s\n", fix.Password)
	}
	return nil
}
