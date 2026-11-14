package importer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// Inspector reads tags used to name imported files.
type Inspector interface {
	Inspect(ctx context.Context, path string) (*inspect.Result, error)
}

// Service plans and runs imports.
type Service struct {
	Pool      *pgxpool.Pool
	Inspector Inspector
	Now       func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func within(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// Plan scans a source directory and records a reviewable plan. It reads and
// hashes the source but changes nothing, and copies nothing.
func (s *Service) Plan(ctx context.Context, lib uuid.UUID, source string, createdBy uuid.UUID) (sqlcgen.ImportPlan, []sqlcgen.ImportItem, error) {
	q := sqlcgen.New(s.Pool)
	cfg, err := q.GetLibraryConfig(ctx, lib)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.ImportPlan{}, nil, apperr.ErrNotFound
	}
	if err != nil {
		return sqlcgen.ImportPlan{}, nil, apperr.ErrUnavailable
	}
	if cfg.Mode != "managed" {
		return sqlcgen.ImportPlan{}, nil, apperr.New(409, "library_not_managed", "Imports are only available for managed libraries.")
	}
	if !filepath.IsAbs(source) {
		return sqlcgen.ImportPlan{}, nil, apperr.Validation("source must be an absolute path")
	}
	srcCanon, err := ingest.CanonicalRoot(source)
	if err != nil {
		return sqlcgen.ImportPlan{}, nil, apperr.Validation("source is not accessible")
	}
	rootCanon, err := ingest.CanonicalRoot(cfg.RootPath)
	if err != nil {
		return sqlcgen.ImportPlan{}, nil, apperr.New(503, "library_unavailable", "The library root is not accessible.")
	}
	if within(rootCanon, srcCanon) || within(srcCanon, rootCanon) {
		return sqlcgen.ImportPlan{}, nil, apperr.Validation("source and library root must not contain each other")
	}
	tmpl := DefaultTemplate
	if cfg.ImportTemplate != nil {
		tmpl = *cfg.ImportTemplate
	}
	listing, err := ingest.Walk(ctx, srcCanon, false)
	if err != nil {
		return sqlcgen.ImportPlan{}, nil, apperr.New(503, "source_unavailable", "The import source could not be listed.")
	}

	type prepared struct {
		e      ingest.Entry
		sha    string
		target string
	}
	var items []prepared
	hashes := []string{}
	for _, e := range listing.Media {
		sum, _, herr := ingest.HashFile(ctx, e.Abs)
		if herr != nil {
			return sqlcgen.ImportPlan{}, nil, apperr.New(503, "source_unavailable", "A source file could not be read.")
		}
		v := Values{Author: "Unknown Author", Title: strings.TrimSuffix(path.Base(e.Rel), path.Ext(e.Rel)), Filename: path.Base(e.Rel)}
		if s.Inspector != nil {
			if res, ierr := s.Inspector.Inspect(ctx, e.Abs); ierr == nil {
				f := metadata.FromTags(res.Format.Tags)
				v.Author = firstString(f[metadata.FieldAuthors], v.Author)
				v.Title = firstString(f[metadata.FieldTitle], v.Title)
				v.Series = firstString(f[metadata.FieldSeriesName], "")
				v.Narrator = firstString(f[metadata.FieldNarrators], "")
			}
		}
		target, rerr := Render(tmpl, v)
		if rerr != nil {
			return sqlcgen.ImportPlan{}, nil, apperr.Validation("import template: " + rerr.Error())
		}
		items = append(items, prepared{e: e, sha: sum, target: target})
		hashes = append(hashes, sum)
	}

	dups := map[string]uuid.UUID{}
	if len(hashes) > 0 {
		rows, err := q.ListFingerprintMatches(ctx, sqlcgen.ListFingerprintMatchesParams{LibraryID: lib, Hashes: hashes})
		if err != nil {
			return sqlcgen.ImportPlan{}, nil, apperr.ErrUnavailable
		}
		for _, r := range rows {
			dups[r.Sha256] = r.FileID
		}
	}
	known, err := q.ListObservations(ctx, lib)
	if err != nil {
		return sqlcgen.ImportPlan{}, nil, apperr.ErrUnavailable
	}
	taken := map[string]bool{}
	for _, k := range known {
		taken[strings.ToLower(k.RelPath)] = true
	}

	var plan sqlcgen.ImportPlan
	var out []sqlcgen.ImportItem
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		tq := sqlcgen.New(tx)
		var cb uuid.NullUUID
		if createdBy != uuid.Nil {
			cb = uuid.NullUUID{UUID: createdBy, Valid: true}
		}
		p, err := tq.CreateImportPlan(ctx, sqlcgen.CreateImportPlanParams{LibraryID: lib, SourcePath: srcCanon, CreatedBy: cb})
		if err != nil {
			return err
		}
		plan = p
		seenHash := map[string]bool{}
		for _, it := range items {
			target, suffixed := it.target, false
			for n := 2; taken[strings.ToLower(target)] || existsOnDisk(rootCanon, target); n++ {
				target, suffixed = WithSuffix(it.target, n), true
			}
			taken[strings.ToLower(target)] = true
			decision, detail := "pending", ""
			var dupOf uuid.NullUUID
			if id, ok := dups[it.sha]; ok {
				dupOf = uuid.NullUUID{UUID: id, Valid: true}
				decision, detail = "skip", "same bytes already in this library"
			} else if seenHash[it.sha] {
				decision, detail = "skip", "same bytes as another file in this import"
			}
			seenHash[it.sha] = true
			row, err := tq.InsertImportItem(ctx, sqlcgen.InsertImportItemParams{PlanID: p.ID, SourceRel: it.e.Rel, SourceSha256: it.sha, SizeBytes: it.e.Size,
				TargetRel: target, Suffixed: suffixed, DuplicateOf: dupOf, Decision: decision})
			if err != nil {
				return err
			}
			if detail != "" {
				if err := tq.SetImportItemState(ctx, sqlcgen.SetImportItemStateParams{ID: row.ID, State: "planned", Detail: &detail}); err != nil {
					return err
				}
				row.Detail = &detail
			}
			out = append(out, row)
		}
		return nil
	})
	if err != nil {
		return sqlcgen.ImportPlan{}, nil, apperr.ErrUnavailable
	}
	return plan, out, nil
}

func firstString(raw []byte, def string) string {
	if len(raw) == 0 {
		return def
	}
	s := strings.Trim(string(raw), `"[]`)
	if i := strings.Index(s, `","`); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	return s
}

func existsOnDisk(root, rel string) bool {
	_, err := os.Lstat(filepath.Join(root, filepath.FromSlash(rel)))
	return err == nil
}

// SetDecision lets a reviewer import or skip one item (for example to keep a duplicate).
func (s *Service) SetDecision(ctx context.Context, plan, item uuid.UUID, decision string) error {
	if decision != "import" && decision != "skip" {
		return apperr.Validation("decision must be import or skip")
	}
	p, err := sqlcgen.New(s.Pool).GetImportPlan(ctx, plan)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return apperr.ErrUnavailable
	}
	if p.State != "planned" {
		return apperr.New(409, "plan_not_editable", "The plan was already approved.")
	}
	if _, err := sqlcgen.New(s.Pool).SetImportDecision(ctx, sqlcgen.SetImportDecisionParams{PlanID: plan, ID: item, Decision: decision}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.ErrNotFound
		}
		return apperr.ErrUnavailable
	}
	return nil
}

// Approve is the bulk approval: every still-pending item becomes an import;
// duplicates stay skipped unless a reviewer chose otherwise.
func (s *Service) Approve(ctx context.Context, plan, by uuid.UUID) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE import_items SET decision='import' WHERE plan_id=$1 AND decision='pending'`, plan); err != nil {
			return err
		}
		_, err := sqlcgen.New(tx).ApproveImportPlan(ctx, sqlcgen.ApproveImportPlanParams{ID: plan, ApprovedBy: uuid.NullUUID{UUID: by, Valid: by != uuid.Nil}, Now: s.now()})
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.New(409, "plan_not_approvable", "The plan is not awaiting approval.")
		}
		return err
	})
}

// Execute copies approved items. It is safe to call again after a crash:
// published items are skipped, partial temporary copies are replaced, and a
// file already present with the reviewed bytes counts as published.
func (s *Service) Execute(ctx context.Context, planID uuid.UUID) error {
	q := sqlcgen.New(s.Pool)
	plan, err := q.StartImportPlan(ctx, planID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // not approved, or already finished
	}
	if err != nil {
		return err
	}
	cfg, err := q.GetLibraryConfig(ctx, plan.LibraryID)
	if err != nil {
		return err
	}
	rootCanon, err := ingest.CanonicalRoot(cfg.RootPath)
	if err != nil {
		return s.finish(ctx, q, planID, "failed")
	}
	items, err := q.ListImportItems(ctx, planID)
	if err != nil {
		return err
	}
	failed := false
	for _, it := range items {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		switch {
		case it.Decision != "import":
			if it.State != "skipped" {
				_ = q.SetImportItemState(ctx, sqlcgen.SetImportItemStateParams{ID: it.ID, State: "skipped", Detail: it.Detail})
			}
		case it.State == "published":
		default:
			if cerr := s.copyOne(ctx, q, plan.SourcePath, rootCanon, it); cerr != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				failed = true
				msg := cerr.Error()
				_ = q.SetImportItemState(ctx, sqlcgen.SetImportItemStateParams{ID: it.ID, State: "failed", Detail: &msg})
			}
		}
	}
	state := "completed"
	if failed {
		state = "failed"
	}
	return s.finish(ctx, q, planID, state)
}

func (s *Service) finish(ctx context.Context, q *sqlcgen.Queries, id uuid.UUID, state string) error {
	return q.FinishImportPlan(ctx, sqlcgen.FinishImportPlanParams{ID: id, State: state, Now: s.now()})
}

func hashOf(path string) (string, error) {
	sum, _, err := ingest.HashFile(context.Background(), path)
	return sum, err
}

func (s *Service) copyOne(ctx context.Context, q *sqlcgen.Queries, srcRoot, dstRoot string, it sqlcgen.ImportItem) error {
	src := filepath.Join(srcRoot, filepath.FromSlash(it.SourceRel))
	dst := filepath.Join(dstRoot, filepath.FromSlash(it.TargetRel))
	if !within(dstRoot, dst) || !within(srcRoot, src) {
		return errors.New("path escapes its root")
	}
	// Idempotent resume: the reviewed bytes are already published here.
	if existsOnDisk(dstRoot, it.TargetRel) {
		if sum, err := hashOf(dst); err == nil && sum == it.SourceSha256 {
			return q.SetImportItemState(ctx, sqlcgen.SetImportItemStateParams{ID: it.ID, State: "published"})
		}
		return errors.New("target already exists with different content; nothing was overwritten")
	}
	dir := filepath.Dir(dst)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create target folder: %w", err)
	}
	if real, err := filepath.EvalSymlinks(dir); err != nil || !within(dstRoot, real) {
		return errors.New("target folder resolves outside the library")
	}
	_ = q.SetImportItemState(ctx, sqlcgen.SetImportItemStateParams{ID: it.ID, State: "copying"})

	tmp := filepath.Join(dir, ".litara-import-"+it.ID.String()+".tmp")
	_ = os.Remove(tmp) // a partial copy from an interrupted run
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer in.Close()
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("create temporary copy: %w", err)
	}
	h := sha256.New()
	_, cerr := io.Copy(io.MultiWriter(out, h), &ctxReader{ctx: ctx, r: in})
	if cerr == nil {
		cerr = out.Sync()
	}
	if closeErr := out.Close(); cerr == nil {
		cerr = closeErr
	}
	if cerr != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("copy: %w", cerr)
	}
	if hex.EncodeToString(h.Sum(nil)) != it.SourceSha256 {
		_ = os.Remove(tmp)
		return errors.New("the source changed after review; re-plan the import")
	}
	// Verify what actually landed on disk, not just what was read.
	if sum, err := hashOf(tmp); err != nil || sum != it.SourceSha256 {
		_ = os.Remove(tmp)
		return errors.New("copy verification failed")
	}
	if err := publishNoOverwrite(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return q.SetImportItemState(ctx, sqlcgen.SetImportItemStateParams{ID: it.ID, State: "published"})
}

// publishNoOverwrite makes tmp appear at dst without ever replacing a file.
// A hard link is atomic and refuses an existing target; where the filesystem
// has no hard links, a checked rename is used (a tiny race remains and is
// documented).
func publishNoOverwrite(tmp, dst string) error {
	if err := os.Link(tmp, dst); err == nil {
		return os.Remove(tmp)
	} else if errors.Is(err, os.ErrExist) {
		return errors.New("target appeared during import; nothing was overwritten")
	}
	if _, err := os.Lstat(dst); err == nil {
		return errors.New("target appeared during import; nothing was overwritten")
	}
	return os.Rename(tmp, dst)
}

type ctxReader struct {
	ctx context.Context
	r   io.Reader
}

func (c *ctxReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}
