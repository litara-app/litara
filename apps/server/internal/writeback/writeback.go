// Package writeback performs explicitly reviewed metadata writes: a JSON
// sidecar export, or an in-file update by a format writer that has recorded
// fidelity evidence (ADR-0048/0051/0052/0053/0057). Every write is staged,
// validated, journaled and published by atomic replacement; backups are
// optional per library and default off, and a failed opt-in backup blocks the
// write. Nothing here runs without a reviewed, approved plan.
package writeback

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

// Writer updates metadata inside one file format. Implementations are
// registered only for formats whose fidelity has been tested.
type Writer interface {
	Format() string
	// Write creates dst from src with changes applied; src is never modified.
	Write(ctx context.Context, src, dst string, changes metadata.Fields) error
	// Validate runs format-specific checks of the staged file.
	Validate(ctx context.Context, orig, staged string, changes metadata.Fields) error
}

// Inspector re-reads staged files to compare them with the original.
type Inspector interface {
	Inspect(ctx context.Context, path string) (*inspect.Result, error)
}

// Service plans, approves and executes writes.
type Service struct {
	Pool      *pgxpool.Pool
	Inspector Inspector
	Writers   map[string]Writer
	Scanner   *ingest.Scanner // registers new content versions after an in-file write
	Metadata  *metadata.Service
	Now       func() time.Time
	// Crash lets tests stop the engine after a journal stage (never set in production).
	Crash func(stage string) error
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) crash(stage string) error {
	if s.Crash != nil {
		return s.Crash(stage)
	}
	return nil
}

// Diff is what a reviewer approves.
type Diff struct {
	Kind    string          `json:"kind"`
	Target  string          `json:"target"`
	Replace bool            `json:"replacesExisting"`
	Changes metadata.Fields `json:"changes"`
	Before  string          `json:"beforeSha256,omitempty"`
}

func sumFile(p string) (string, error) {
	sum, _, err := ingest.HashFile(context.Background(), p)
	return sum, err
}

func sumBytes(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// sidecarContent renders the effective metadata of a recording as Litara JSON.
func (s *Service) sidecarContent(ctx context.Context, rec uuid.UUID) ([]byte, metadata.Fields, error) {
	q := sqlcgen.New(s.Pool)
	row, err := q.GetRecordingRow(ctx, rec)
	if err != nil {
		return nil, nil, apperr.ErrNotFound
	}
	title, err := q.GetTitleRow(ctx, row.TitleID)
	if err != nil {
		return nil, nil, apperr.ErrUnavailable
	}
	out := map[string]any{"title": title.Title}
	if len(title.Authors) > 0 {
		out["authors"] = title.Authors
	}
	if len(row.Narrators) > 0 {
		out["narrators"] = row.Narrators
	}
	if title.SeriesName != nil {
		series := map[string]any{"name": *title.SeriesName}
		if title.SeriesIndex != nil {
			series["index"] = *title.SeriesIndex
		}
		out["series"] = series
	}
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	f, err := metadata.ParseLitaraJSON(b)
	if err != nil {
		return nil, nil, err
	}
	return append(b, '\n'), f, nil
}

// PlanSidecar proposes exporting a recording's effective metadata to a Litara
// JSON sidecar in its folder. Nothing is written yet.
func (s *Service) PlanSidecar(ctx context.Context, rec uuid.UUID) (sqlcgen.WritebackPlan, error) {
	q := sqlcgen.New(s.Pool)
	row, err := q.GetRecordingRow(ctx, rec)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.WritebackPlan{}, apperr.ErrNotFound
	}
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.ErrUnavailable
	}
	fileID, err := q.FirstRecordingFile(ctx, rec)
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.New(409, "recording_incomplete", "The recording has no files.")
	}
	cur, err := q.GetFileCurrent(ctx, fileID)
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.ErrUnavailable
	}
	_, changes, err := s.sidecarContent(ctx, rec)
	if err != nil {
		return sqlcgen.WritebackPlan{}, err
	}
	dir := path.Dir(cur.RelPath)
	name := "litara.json"
	if dir == "." {
		dir = ""
		name = strings.TrimSuffix(path.Base(cur.RelPath), path.Ext(cur.RelPath)) + ".litara.json"
	}
	target := path.Join(dir, name)
	cfg, err := q.GetLibraryConfig(ctx, row.LibraryID)
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.ErrUnavailable
	}
	root, err := ingest.CanonicalRoot(cfg.RootPath)
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.New(503, "library_unavailable", "The library root is not accessible.")
	}
	d := Diff{Kind: "sidecar", Target: target, Changes: changes}
	var base *string
	if sum, herr := sumFile(filepath.Join(root, filepath.FromSlash(target))); herr == nil {
		d.Replace, d.Before = true, sum
		base = &sum
	}
	raw, _ := json.Marshal(d)
	p, err := q.CreateWritebackPlan(ctx, sqlcgen.CreateWritebackPlanParams{LibraryID: row.LibraryID, FileID: fileID, BaseVersion: cur.ContentVersion,
		Kind: "sidecar", Diff: raw, RecordingID: uuid.NullUUID{UUID: rec, Valid: true}, TargetRel: target, BaseSha256: base})
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.ErrUnavailable
	}
	return p, nil
}

// PlanInFile proposes writing changes into a media file. It is refused unless a
// writer for the format is registered AND enabled with recorded fidelity
// evidence (ADR-0052).
func (s *Service) PlanInFile(ctx context.Context, fileID uuid.UUID, changes metadata.Fields) (sqlcgen.WritebackPlan, error) {
	q := sqlcgen.New(s.Pool)
	cur, err := q.GetFileCurrent(ctx, fileID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.WritebackPlan{}, apperr.ErrNotFound
	}
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.ErrUnavailable
	}
	format := strings.TrimPrefix(strings.ToLower(filepath.Ext(cur.RelPath)), ".")
	w, registered := s.Writers[format]
	cap, cerr := q.GetWriterCapability(ctx, format)
	if !registered || cerr != nil || !cap.Enabled || cap.EvidenceRef == nil {
		return sqlcgen.WritebackPlan{}, apperr.New(409, "writer_disabled",
			"In-file writing is not enabled for this format; export a sidecar instead.")
	}
	_ = w
	if len(changes) == 0 {
		return sqlcgen.WritebackPlan{}, apperr.Validation("no changes to write")
	}
	if cur.Sha256 == nil {
		return sqlcgen.WritebackPlan{}, apperr.New(409, "file_unverified", "The file has no fingerprint yet.")
	}
	d := Diff{Kind: "in_file", Target: cur.RelPath, Replace: true, Changes: changes, Before: *cur.Sha256}
	raw, _ := json.Marshal(d)
	fmtName := format
	p, err := q.CreateWritebackPlan(ctx, sqlcgen.CreateWritebackPlanParams{LibraryID: cur.LibraryID, FileID: fileID, BaseVersion: cur.ContentVersion,
		Kind: "in_file", Format: &fmtName, Diff: raw, TargetRel: cur.RelPath, BaseSha256: cur.Sha256})
	if err != nil {
		return sqlcgen.WritebackPlan{}, apperr.ErrUnavailable
	}
	return p, nil
}

// Approve records the reviewer's explicit approval of the exact diff.
func (s *Service) Approve(ctx context.Context, plan, by uuid.UUID) error {
	_, err := sqlcgen.New(s.Pool).ApproveWritebackPlan(ctx, sqlcgen.ApproveWritebackPlanParams{ID: plan,
		ApprovedBy: uuid.NullUUID{UUID: by, Valid: by != uuid.Nil}, Now: s.now()})
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(409, "plan_not_approvable", "The plan is not awaiting approval.")
	}
	if err != nil {
		return apperr.ErrUnavailable
	}
	return nil
}

func (s *Service) stage(ctx context.Context, id uuid.UUID, stage, detail string, stagedPath, stagedSum, backup *string) error {
	var d *string
	if detail != "" {
		d = &detail
	}
	return sqlcgen.New(s.Pool).SetWritebackStage(ctx, sqlcgen.SetWritebackStageParams{ID: id, Stage: stage, Detail: d,
		StagedPath: stagedPath, StagedSha256: stagedSum, BackupRef: backup, Now: s.now()})
}

func (s *Service) refuse(ctx context.Context, id uuid.UUID, staged, why string) error {
	if staged != "" {
		_ = os.Remove(staged)
	}
	if err := s.stage(ctx, id, "refused", why, nil, nil, nil); err != nil {
		return err
	}
	return apperr.New(409, "write_refused", why)
}

// Execute runs an approved plan. A refusal leaves the original untouched.
func (s *Service) Execute(ctx context.Context, planID uuid.UUID) error {
	q := sqlcgen.New(s.Pool)
	plan, err := q.GetWritebackPlan(ctx, planID)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return apperr.ErrUnavailable
	}
	if plan.Stage != "approved" {
		return apperr.New(409, "plan_not_runnable", "Only an approved plan can run (current stage: "+plan.Stage+").")
	}
	cfg, err := q.GetLibraryConfig(ctx, plan.LibraryID)
	if err != nil {
		return apperr.ErrUnavailable
	}
	root, err := ingest.CanonicalRoot(cfg.RootPath)
	if err != nil {
		return s.refuse(ctx, planID, "", "The library root is not accessible.")
	}
	target := filepath.Join(root, filepath.FromSlash(plan.TargetRel))
	if rel, rerr := filepath.Rel(root, target); rerr != nil || strings.HasPrefix(rel, "..") {
		return s.refuse(ctx, planID, "", "The target is outside the library root.")
	}

	var diff Diff
	_ = json.Unmarshal(plan.Diff, &diff)

	// Recheck: what was reviewed must still be what is on disk (ADR-0048).
	if err := s.recheckBase(ctx, plan, target); err != nil {
		return s.refuse(ctx, planID, "", err.Error())
	}

	staged := filepath.Join(filepath.Dir(target), ".litara-write-"+plan.ID.String()+".tmp")
	// Journal the intent before creating anything, so recovery can find it.
	if err := s.stage(ctx, planID, "staged", "", &staged, nil, nil); err != nil {
		return apperr.ErrUnavailable
	}
	_ = os.Remove(staged)

	switch plan.Kind {
	case "sidecar":
		body, _, cerr := s.sidecarContent(ctx, plan.RecordingID.UUID)
		if cerr != nil {
			return s.refuse(ctx, planID, staged, "Could not render the sidecar.")
		}
		if err := writeFileSync(staged, body); err != nil {
			return s.refuse(ctx, planID, staged, "Could not stage the sidecar.")
		}
	case "in_file":
		w := s.Writers[derefStr(plan.Format)]
		if w == nil {
			return s.refuse(ctx, planID, staged, "No writer is registered for this format.")
		}
		if err := w.Write(ctx, target, staged, diff.Changes); err != nil {
			return s.refuse(ctx, planID, staged, "The writer failed: "+err.Error())
		}
	}
	if err := s.crash("after_stage_write"); err != nil {
		return err
	}
	sum, err := sumFile(staged)
	if err != nil {
		return s.refuse(ctx, planID, staged, "Could not read the staged file.")
	}
	if verr := s.validate(ctx, plan, diff, target, staged); verr != nil {
		return s.refuse(ctx, planID, staged, "Validation failed: "+verr.Error())
	}
	if err := s.stage(ctx, planID, "validated", "", nil, &sum, nil); err != nil {
		return apperr.ErrUnavailable
	}
	if err := s.crash("after_validated"); err != nil {
		return err
	}

	// Optional per-library backup; if enabled, failure blocks the write (ADR-0051).
	if cfg.WritebackBackups {
		ref, berr := backup(target, cfg.BackupRoot, plan.ID, plan.TargetRel)
		if berr != nil {
			return s.refuse(ctx, planID, staged, "Backup failed, so nothing was written: "+berr.Error())
		}
		if err := s.stage(ctx, planID, "backed_up", "", nil, nil, &ref); err != nil {
			return apperr.ErrUnavailable
		}
		if err := s.crash("after_backup"); err != nil {
			return err
		}
	}
	return s.publish(ctx, plan.ID, plan, target, staged, sum)
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// recheckBase confirms the reviewed file/target is unchanged.
func (s *Service) recheckBase(ctx context.Context, plan sqlcgen.WritebackPlan, target string) error {
	q := sqlcgen.New(s.Pool)
	if plan.Kind == "in_file" {
		cur, err := q.GetFileCurrent(ctx, plan.FileID)
		if err != nil || cur.ContentVersion != plan.BaseVersion {
			return errors.New("The file's content version changed after review.")
		}
	}
	if plan.BaseSha256 != nil {
		sum, err := sumFile(target)
		if err != nil || sum != *plan.BaseSha256 {
			return errors.New("The target changed after review; create a new plan.")
		}
	} else if plan.Kind == "sidecar" {
		if _, err := os.Lstat(target); err == nil {
			return errors.New("A sidecar appeared after review; create a new plan.")
		}
	}
	return nil
}

func (s *Service) validate(ctx context.Context, plan sqlcgen.WritebackPlan, diff Diff, target, staged string) error {
	if plan.Kind == "sidecar" {
		b, err := os.ReadFile(staged)
		if err != nil {
			return err
		}
		got, err := metadata.ParseLitaraJSON(b)
		if err != nil {
			return err
		}
		for k, v := range diff.Changes {
			if string(got[k]) != string(v) {
				return fmt.Errorf("sidecar does not round-trip field %s", k)
			}
		}
		return nil
	}
	info, err := os.Stat(staged)
	if err != nil || info.Size() == 0 {
		return errors.New("staged file is empty")
	}
	if s.Inspector == nil {
		return errors.New("no inspector available to verify the staged file")
	}
	a, aerr := s.Inspector.Inspect(ctx, target)
	b, berr := s.Inspector.Inspect(ctx, staged)
	if aerr != nil || berr != nil {
		return errors.New("staged file could not be inspected")
	}
	if a.Format.Name != b.Format.Name {
		return errors.New("container format changed")
	}
	if a.Format.DurationMs != nil && b.Format.DurationMs != nil {
		d := *a.Format.DurationMs - *b.Format.DurationMs
		if d < -50 || d > 50 {
			return errors.New("duration changed")
		}
	}
	if len(a.Chapters) != len(b.Chapters) {
		return errors.New("chapters were lost or added")
	}
	if len(a.Artwork) != len(b.Artwork) {
		return errors.New("artwork was lost or added")
	}
	if len(a.Streams) != len(b.Streams) {
		return errors.New("streams changed")
	}
	if w := s.Writers[derefStr(plan.Format)]; w != nil {
		return w.Validate(ctx, target, staged, diff.Changes)
	}
	return nil
}

// publish atomically replaces the target with the verified staged file.
func (s *Service) publish(ctx context.Context, id uuid.UUID, plan sqlcgen.WritebackPlan, target, staged, sum string) error {
	// Last chance: the original must still be the reviewed bytes.
	if err := s.recheckBase(ctx, plan, target); err != nil {
		return s.refuse(ctx, id, staged, err.Error())
	}
	if got, err := sumFile(staged); err != nil || got != sum {
		return s.refuse(ctx, id, staged, "The staged file changed after validation.")
	}
	if err := os.Rename(staged, target); err != nil {
		return s.refuse(ctx, id, staged, "Replacement failed: "+err.Error())
	}
	if err := s.stage(ctx, id, "published", "", nil, nil, nil); err != nil {
		return apperr.ErrUnavailable
	}
	return s.afterPublish(ctx, plan)
}

func (s *Service) afterPublish(ctx context.Context, plan sqlcgen.WritebackPlan) error {
	if plan.Kind == "in_file" && s.Scanner != nil {
		// The bytes changed: register a new content version; positions are not remapped.
		return s.Scanner.RecordReplacement(ctx, plan.LibraryID, plan.FileID)
	}
	return nil
}

// Recover finishes or abandons plans interrupted by a crash. A verified,
// journaled staged file is published; anything else is cleaned up and the
// original is left as it was. It never produces a torn target.
func (s *Service) Recover(ctx context.Context) (completed, abandoned int, err error) {
	q := sqlcgen.New(s.Pool)
	plans, err := q.ListRecoverableWritebacks(ctx)
	if err != nil {
		return 0, 0, err
	}
	for _, p := range plans {
		cfg, cerr := q.GetLibraryConfig(ctx, p.LibraryID)
		if cerr != nil {
			continue
		}
		root, rerr := ingest.CanonicalRoot(cfg.RootPath)
		if rerr != nil {
			continue // root unavailable: try again later
		}
		target := filepath.Join(root, filepath.FromSlash(p.TargetRel))
		staged := derefStr(p.StagedPath)
		if staged == "" {
			staged = filepath.Join(filepath.Dir(target), ".litara-write-"+p.ID.String()+".tmp")
		}
		if p.StagedSha256 != nil {
			if cur, e := sumFile(target); e == nil && cur == *p.StagedSha256 {
				// Published before the journal advanced.
				_ = s.stage(ctx, p.ID, "published", "recovered: already in place", nil, nil, nil)
				_ = os.Remove(staged)
				_ = s.afterPublish(ctx, p)
				completed++
				continue
			}
		}
		okToComplete := p.StagedSha256 != nil && (p.Stage == "validated" || p.Stage == "backed_up")
		if okToComplete {
			if got, e := sumFile(staged); e == nil && got == *p.StagedSha256 && s.recheckBase(ctx, p, target) == nil {
				if cfg.WritebackBackups && p.BackupRef == nil {
					okToComplete = false // a backup was required but never completed
				} else if e := os.Rename(staged, target); e == nil {
					_ = s.stage(ctx, p.ID, "recovered", "completed from the journal", nil, nil, nil)
					_ = s.afterPublish(ctx, p)
					completed++
					continue
				}
			}
		}
		_ = os.Remove(staged)
		_ = s.stage(ctx, p.ID, "abandoned", "interrupted before a verified stage; original untouched", nil, nil, nil)
		abandoned++
	}
	return completed, abandoned, nil
}

func writeFileSync(p string, b []byte) error {
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	_, werr := f.Write(b)
	if werr == nil {
		werr = f.Sync()
	}
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	return werr
}

// backup copies the original into the configured backup root and verifies it.
func backup(src string, backupRoot *string, id uuid.UUID, rel string) (string, error) {
	if backupRoot == nil || *backupRoot == "" {
		return "", errors.New("no backup location configured")
	}
	dst := filepath.Join(*backupRoot, id.String(), filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	in, err := os.Open(src)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil // nothing to back up for a new sidecar
		}
		return "", err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, cerr := io.Copy(io.MultiWriter(out, h), in)
	if cerr == nil {
		cerr = out.Sync()
	}
	if c := out.Close(); cerr == nil {
		cerr = c
	}
	if cerr != nil {
		return "", cerr
	}
	if got, err := sumFile(dst); err != nil || got != hex.EncodeToString(h.Sum(nil)) {
		return "", errors.New("backup verification failed")
	}
	return dst, nil
}
