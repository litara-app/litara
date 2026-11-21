package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/deranjer/ebooker/apps/server/internal/apicompat"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
)

// apiBaselineCmd keeps the API compatible (ADR-0082). It needs no database.
//
//	ctl api-baseline check                 verify the API against the baseline and every release (exit 1 on a problem)
//	ctl api-baseline update                accept the current API as the development baseline (refuses breaking changes)
//	ctl api-baseline release VERSION       freeze the current API as an immutable release, for example 1.0.0
func apiBaselineCmd(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("api-baseline", flag.ContinueOnError)
	dir := fs.String("dir", filepath.Join("internal", "apicompat", "snapshots"), "snapshot directory (run from apps/server)")
	if len(args) == 0 {
		return errors.New("usage: ctl api-baseline check|update|release VERSION [--dir DIR]")
	}
	verb, rest := args[0], args[1:]
	var version string
	if verb == "release" {
		if len(rest) == 0 {
			return errors.New("usage: ctl api-baseline release VERSION")
		}
		version, rest = rest[0], rest[1:]
	}
	if err := fs.Parse(rest); err != nil {
		return err
	}
	doc, err := httpapi.OpenAPIJSON()
	if err != nil {
		return err
	}
	switch verb {
	case "check":
		problems := apicompat.Verify(os.DirFS(*dir), doc)
		for _, p := range problems {
			fmt.Fprintln(out, "  -", p)
		}
		if len(problems) > 0 {
			return fmt.Errorf("%d API compatibility problem(s)", len(problems))
		}
		fmt.Fprintln(out, "API compatible with the baseline and every release.")
		return nil
	case "update":
		changes, err := apicompat.Update(*dir, doc)
		for _, c := range changes {
			fmt.Fprintln(out, " ", c)
		}
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "Baseline updated (%d change(s)). Review the diff of the snapshot files before committing.\n", len(changes))
		return nil
	case "release":
		changes, err := apicompat.ReleaseVersion(*dir, doc, version)
		for _, c := range changes {
			fmt.Fprintln(out, " ", c)
		}
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "Released API %s. It is now frozen: from here on only additive change is possible, through another release.\n", version)
		return nil
	}
	return fmt.Errorf("unknown api-baseline command %q", verb)
}
