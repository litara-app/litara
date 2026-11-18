package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/deranjer/ebooker/apps/server/internal/config"
	"github.com/deranjer/ebooker/apps/server/internal/db"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

// builtInWriters are the formats this build has a writer for (ADR-0052). Enabling anything else is refused.
var builtInWriters = map[string]bool{"epub": true}

var writerFormats = []string{"epub", "mp3", "flac", "m4a", "m4b"}

// writersCmd lists in-file writer enablement and lets an operator enable or disable a built-in writer.
// Enabling records an evidence reference (the fidelity report the operator relied on) and is an explicit, reviewable act:
// nothing is enabled by default and no migration enables anything.
//
//	ctl writers list
//	ctl writers enable epub --evidence research/t007/evidence/m2-epub-writer/README.md
//	ctl writers disable epub
func writersCmd(ctx context.Context, cfg *config.Config, args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: ctl writers list | enable FORMAT --evidence REF | disable FORMAT")
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	q := sqlcgen.New(pool)
	switch args[0] {
	case "list":
		for _, f := range writerFormats {
			c, err := q.GetWriterCapability(ctx, f)
			if err != nil {
				return err
			}
			state := "disabled"
			if c.Enabled {
				state = "enabled"
			}
			ev := "-"
			if c.EvidenceRef != nil {
				ev = *c.EvidenceRef
			}
			fmt.Fprintf(out, "%-5s %-8s built-in=%-5v evidence=%s\n", f, state, builtInWriters[f], ev)
		}
		return nil
	case "enable":
		fs := flag.NewFlagSet("enable", flag.ContinueOnError)
		evidence := fs.String("evidence", "", "reference to the retained fidelity evidence for this writer")
		if len(args) < 2 {
			return errors.New("usage: ctl writers enable FORMAT --evidence REF")
		}
		format := args[1]
		if err := fs.Parse(args[2:]); err != nil {
			return err
		}
		if !builtInWriters[format] {
			return fmt.Errorf("this build has no %s writer; in-file writing stays disabled for it (ADR-0052)", format)
		}
		ref := strings.TrimSpace(*evidence)
		if ref == "" {
			return errors.New("--evidence is required: name the fidelity report that justifies enabling this writer")
		}
		if _, err := os.Stat(ref); err != nil {
			return fmt.Errorf("evidence %q is not readable from here: %w", ref, err)
		}
		if err := q.SetWriterCapability(ctx, sqlcgen.SetWriterCapabilityParams{Format: format, Enabled: true, EvidenceRef: &ref}); err != nil {
			return err
		}
		fmt.Fprintf(out, "%s writer enabled (evidence: %s)\n", format, ref)
		return nil
	case "disable":
		if len(args) < 2 {
			return errors.New("usage: ctl writers disable FORMAT")
		}
		format := args[1]
		c, err := q.GetWriterCapability(ctx, format)
		if err != nil {
			return fmt.Errorf("unknown format %q", format)
		}
		if err := q.SetWriterCapability(ctx, sqlcgen.SetWriterCapabilityParams{Format: format, Enabled: false, EvidenceRef: c.EvidenceRef}); err != nil {
			return err
		}
		fmt.Fprintf(out, "%s writer disabled\n", format)
		return nil
	}
	return fmt.Errorf("unknown writers action %q", args[0])
}
