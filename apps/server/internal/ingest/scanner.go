package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// Inspector is the subset of inspect.Inspector the scanner needs.
type Inspector interface {
	Inspect(ctx context.Context, path string) (*inspect.Result, error)
}

// Scanner reconciles one library root with the catalog.
type Scanner struct {
	Pool      *pgxpool.Pool
	Inspector Inspector // nil skips duration/tag extraction (metadata marked failed)
	Now       func() time.Time
	Log       *slog.Logger
}

// Outcome summarizes one scan run.
type Outcome struct {
	Health    string
	FilesSeen int
	Added     int
	Moved     int
	Replaced  int
	Pending   int // observed but not yet stable
	Absent    int // not seen this scan
	Review    int // review items raised or refreshed
}

func (s *Scanner) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Scanner) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

// Run executes a queued scan run. It is safe to call again after a crash: all
// catalog changes are idempotent per path and per content version.
func (s *Scanner) Run(ctx context.Context, runID uuid.UUID) (Outcome, error) {
	q := sqlcgen.New(s.Pool)
	run, err := q.MarkScanRunning(ctx, sqlcgen.MarkScanRunningParams{ID: runID, Now: s.now()})
	if errors.Is(err, pgx.ErrNoRows) {
		return Outcome{}, nil // already finished
	}
	if err != nil {
		return Outcome{}, err
	}
	out, rerr := s.reconcile(ctx, run)
	if ctx.Err() != nil {
		return out, ctx.Err() // leave the run active so the next execution resumes it
	}
	state, failure := "completed", (*string)(nil)
	if rerr != nil {
		state = "failed"
		msg := rerr.Error()
		failure = &msg
	}
	var health *string
	if out.Health != "" {
		health = &out.Health
	}
	if err := q.FinishScanRun(ctx, sqlcgen.FinishScanRunParams{ID: run.ID, State: state, Health: health,
		FilesSeen: int32(out.FilesSeen), Failure: failure, Now: s.now()}); err != nil {
		return out, err
	}
	return out, rerr
}

type obs = sqlcgen.ListObservationsRow

func (s *Scanner) reconcile(ctx context.Context, run sqlcgen.ScanRun) (Outcome, error) {
	var out Outcome
	q := sqlcgen.New(s.Pool)
	cfg, err := q.GetLibraryConfig(ctx, run.LibraryID)
	if err != nil {
		return out, fmt.Errorf("library configuration: %w", err)
	}
	setHealth := func(state, detail string) error {
		out.Health = state
		var d *string
		if detail != "" {
			d = &detail
		}
		return q.SetRootHealthAt(ctx, sqlcgen.SetRootHealthAtParams{LibraryID: run.LibraryID, State: state, Detail: d, Now: s.now()})
	}

	state, detail := CheckRoot(cfg.RootPath, cfg.SentinelPath, cfg.SentinelSha256)
	if state != HealthHealthy {
		// Retain the catalog and history; nothing is marked missing (ADR-0050/0059).
		return out, setHealth(state, detail)
	}
	listing, err := Walk(ctx, cfg.RootPath, cfg.FollowSymlinks)
	if err != nil {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		return out, setHealth(HealthUnavailable, "root listing failed")
	}
	known, err := q.ListObservations(ctx, run.LibraryID)
	if err != nil {
		return out, err
	}
	liveKnown := 0
	for _, o := range known {
		if !o.Missing {
			liveKnown++
		}
	}
	if cfg.SentinelPath == nil && len(listing.Media) == 0 && liveKnown > 0 {
		// An empty listing with no identity check cannot prove the files are gone.
		return out, setHealth(HealthUnavailable, "root listing is empty and no identity sentinel is configured")
	}
	if err := setHealth(HealthHealthy, ""); err != nil {
		return out, err
	}
	out.FilesSeen = len(listing.Media)

	byPath := map[string]obs{}
	for _, o := range known {
		byPath[o.RelPath] = o
	}
	cands, err := q.ListCandidates(ctx, run.LibraryID)
	if err != nil {
		return out, err
	}
	candByPath := map[string]sqlcgen.FileCandidate{}
	for _, c := range cands {
		candByPath[c.RelPath] = c
	}
	seen := map[string]bool{}
	var unchanged []uuid.UUID
	var restore []obs
	verify := run.Trigger == "verify"
	now := s.now()
	stability := time.Duration(cfg.StabilitySecs) * time.Second

	type pending struct {
		e     Entry
		known *obs
		sha   string
	}
	var stableNew []pending
	var stableChanged []pending

	for _, e := range listing.Media {
		seen[e.Rel] = true
		o, isKnown := byPath[e.Rel]
		if isKnown && o.SizeBytes == e.Size && o.Mtime.Equal(e.Mtime) {
			if verify && o.Sha256 != nil {
				sum, _, herr := HashFile(ctx, e.Abs)
				if herr != nil {
					return out, herr
				}
				if sum != *o.Sha256 {
					// Bytes changed while size and mtime stayed the same (ADR-0058).
					oc := o
					stableChanged = append(stableChanged, pending{e: e, known: &oc, sha: sum})
					continue
				}
				if err := q.TouchFingerprint(ctx, sqlcgen.TouchFingerprintParams{ContentVersion: o.ContentVersion, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
					return out, err
				}
			}
			unchanged = append(unchanged, o.FileID)
			if o.Missing || !o.Available {
				restore = append(restore, o)
			}
			if _, ok := candByPath[e.Rel]; ok {
				_ = q.DeleteCandidate(ctx, sqlcgen.DeleteCandidateParams{LibraryID: run.LibraryID, RelPath: e.Rel})
			}
			continue
		}
		// New path, or a known path whose size/mtime changed: must be stable first.
		c, hasCand := candByPath[e.Rel]
		if !hasCand || c.SizeBytes != e.Size || !c.Mtime.Equal(e.Mtime) {
			if err := q.UpsertCandidate(ctx, sqlcgen.UpsertCandidateParams{LibraryID: run.LibraryID, RelPath: e.Rel, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
				return out, err
			}
			out.Pending++
			continue
		}
		if now.Sub(c.FirstSeenAt) < stability {
			_ = q.UpsertCandidate(ctx, sqlcgen.UpsertCandidateParams{LibraryID: run.LibraryID, RelPath: e.Rel, SizeBytes: e.Size, Mtime: e.Mtime, Now: now})
			out.Pending++
			continue
		}
		sum, n, herr := HashFile(ctx, e.Abs)
		if herr != nil {
			if ctx.Err() != nil {
				return out, ctx.Err()
			}
			s.log().Warn("hash failed; will retry next scan", "path", e.Rel, "error", herr)
			out.Pending++
			continue
		}
		if n != e.Size { // changed while hashing
			_ = q.UpsertCandidate(ctx, sqlcgen.UpsertCandidateParams{LibraryID: run.LibraryID, RelPath: e.Rel, SizeBytes: n, Mtime: e.Mtime, Now: now})
			out.Pending++
			continue
		}
		if isKnown {
			oc := o
			stableChanged = append(stableChanged, pending{e: e, known: &oc, sha: sum})
		} else {
			stableNew = append(stableNew, pending{e: e, sha: sum})
		}
	}
	if err := q.DeleteCandidatesNotIn(ctx, sqlcgen.DeleteCandidatesNotInParams{LibraryID: run.LibraryID, Paths: keys(seen)}); err != nil {
		return out, err
	}

	// Files not seen this scan (listing is complete, root healthy).
	var absent []obs
	for _, o := range known {
		if !seen[o.RelPath] {
			absent = append(absent, o)
		}
	}

	// Same-path replacements (ADR-0044): same file ID, new content version.
	for _, p := range stableChanged {
		if p.known.Sha256 != nil && *p.known.Sha256 == p.sha {
			if err := s.refreshStat(ctx, run.LibraryID, *p.known, p.e, now); err != nil {
				return out, err
			}
			continue
		}
		if err := s.replace(ctx, run.LibraryID, *p.known, p.e, p.sha, now); err != nil {
			return out, err
		}
		out.Replaced++
	}

	// Moves: a unique full-file match between one missing and one new file.
	absentBySHA := map[string][]obs{}
	for _, a := range absent {
		if a.Sha256 != nil {
			absentBySHA[*a.Sha256] = append(absentBySHA[*a.Sha256], a)
		}
	}
	newBySHA := map[string][]pending{}
	for _, p := range stableNew {
		newBySHA[p.sha] = append(newBySHA[p.sha], p)
	}
	moved := map[uuid.UUID]bool{}
	raised := map[string]bool{}
	for _, p := range stableNew {
		as := absentBySHA[p.sha]
		switch {
		case len(as) == 0:
			if err := s.addFile(ctx, run.LibraryID, p.e, p.sha, now); err != nil {
				return out, err
			}
			out.Added++
		case len(as) == 1 && len(newBySHA[p.sha]) == 1:
			if err := s.move(ctx, run.LibraryID, as[0], p.e, now); err != nil {
				return out, err
			}
			moved[as[0].FileID] = true
			out.Moved++
		default:
			// Ambiguous: never guess (ADR-0044). The new path stays a pending candidate.
			var np []string
			for _, n := range newBySHA[p.sha] {
				np = append(np, n.e.Rel)
			}
			if !raised[p.sha] {
				if err := s.raiseMoveReview(ctx, run.LibraryID, p.sha, as, np); err != nil {
					return out, err
				}
				raised[p.sha] = true
				out.Review++
			}
			out.Pending++
		}
	}

	// Absence: two healthy scans confirm; never deleted (ADR-0050).
	var absentIDs []uuid.UUID
	for _, a := range absent {
		if moved[a.FileID] {
			continue
		}
		absentIDs = append(absentIDs, a.FileID)
		out.Absent++
	}
	if len(absentIDs) > 0 {
		if err := q.MarkObservationsAbsent(ctx, absentIDs); err != nil {
			return out, err
		}
		for _, a := range absent {
			if !moved[a.FileID] && a.MissingScans+1 >= 2 && a.Available {
				if err := q.SetCurrentVersionAvailable(ctx, sqlcgen.SetCurrentVersionAvailableParams{FileID: a.FileID, Available: false}); err != nil {
					return out, err
				}
			}
		}
	}
	if len(unchanged) > 0 {
		if err := q.TouchObservations(ctx, sqlcgen.TouchObservationsParams{FileIds: unchanged, Now: now}); err != nil {
			return out, err
		}
		for _, o := range restore {
			if err := q.SetCurrentVersionAvailable(ctx, sqlcgen.SetCurrentVersionAvailableParams{FileID: o.FileID, Available: true}); err != nil {
				return out, err
			}
		}
	}
	if listing.Complete {
		if _, err := s.Group(ctx, run.LibraryID); err != nil {
			return out, fmt.Errorf("group: %w", err)
		}
		if err := s.Associate(ctx, run.LibraryID, listing); err != nil {
			return out, fmt.Errorf("associate: %w", err)
		}
		if err := metadata.New(s.Pool).Refresh(ctx, run.LibraryID); err != nil {
			return out, fmt.Errorf("metadata: %w", err)
		}
	}
	return out, nil
}

func keys(m map[string]bool) []string {
	k := make([]string, 0, len(m))
	for p := range m {
		k = append(k, p)
	}
	sort.Strings(k)
	return k
}

func (s *Scanner) inspectFile(ctx context.Context, e Entry) (completeness string, result []byte, failure *string, durationMs *int64) {
	if s.Inspector == nil {
		f := "no inspector configured"
		return "failed", nil, &f, nil
	}
	res, err := s.Inspector.Inspect(ctx, e.Abs)
	if err != nil {
		f := err.Error()
		return "failed", nil, &f, nil
	}
	b, _ := json.Marshal(res)
	return string(res.Completeness), b, nil, res.Format.DurationMs
}

func (s *Scanner) newVersion(ctx context.Context, q *sqlcgen.Queries, fileID uuid.UUID, e Entry, sha string, now time.Time,
	completeness string, result []byte, failure *string, dur *int64) error {
	ver := uuid.New()
	size := e.Size
	if err := q.InsertFileVersion(ctx, sqlcgen.InsertFileVersionParams{ContentVersion: ver, FileID: fileID, Locator: e.Abs,
		Filename: path.Base(e.Rel), MimeType: e.Mime, SizeBytes: &size, DurationMs: dur}); err != nil {
		return err
	}
	if err := q.InsertFingerprint(ctx, sqlcgen.InsertFingerprintParams{ContentVersion: ver, Sha256: sha, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
		return err
	}
	return q.InsertFileMetadata(ctx, sqlcgen.InsertFileMetadataParams{ContentVersion: ver, Completeness: completeness, Result: result, Failure: failure})
}

func (s *Scanner) addFile(ctx context.Context, lib uuid.UUID, e Entry, sha string, now time.Time) error {
	c, r, f, d := s.inspectFile(ctx, e)
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		id := uuid.New()
		if err := q.InsertMediaFile(ctx, id); err != nil {
			return err
		}
		if err := s.newVersion(ctx, q, id, e, sha, now, c, r, f, d); err != nil {
			return err
		}
		if err := q.InsertObservation(ctx, sqlcgen.InsertObservationParams{FileID: id, LibraryID: lib, RelPath: e.Rel, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
			return err
		}
		return q.DeleteCandidate(ctx, sqlcgen.DeleteCandidateParams{LibraryID: lib, RelPath: e.Rel})
	})
}

// replace creates a new content version for the same file ID and invalidates
// affected recording layouts; saved positions are never remapped (ADR-0044).
func (s *Scanner) replace(ctx context.Context, lib uuid.UUID, o obs, e Entry, sha string, now time.Time) error {
	c, r, f, d := s.inspectFile(ctx, e)
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if err := q.RetireCurrentVersion(ctx, o.FileID); err != nil {
			return err
		}
		if err := s.newVersion(ctx, q, o.FileID, e, sha, now, c, r, f, d); err != nil {
			return err
		}
		if err := q.BumpLayoutForFile(ctx, o.FileID); err != nil {
			return err
		}
		if err := q.UpdateObservation(ctx, sqlcgen.UpdateObservationParams{FileID: o.FileID, RelPath: e.Rel, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
			return err
		}
		return q.DeleteCandidate(ctx, sqlcgen.DeleteCandidateParams{LibraryID: lib, RelPath: e.Rel})
	})
}

// refreshStat records a touched-but-identical file (same bytes, new mtime).
func (s *Scanner) refreshStat(ctx context.Context, lib uuid.UUID, o obs, e Entry, now time.Time) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if err := q.TouchFingerprint(ctx, sqlcgen.TouchFingerprintParams{ContentVersion: o.ContentVersion, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
			return err
		}
		if err := q.UpdateObservation(ctx, sqlcgen.UpdateObservationParams{FileID: o.FileID, RelPath: e.Rel, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
			return err
		}

		if err := q.SetCurrentVersionAvailable(ctx, sqlcgen.SetCurrentVersionAvailableParams{FileID: o.FileID, Available: true}); err != nil {
			return err
		}
		return q.DeleteCandidate(ctx, sqlcgen.DeleteCandidateParams{LibraryID: lib, RelPath: e.Rel})
	})
}

// move keeps the file ID and content version; only the path changes (ADR-0044).
func (s *Scanner) move(ctx context.Context, lib uuid.UUID, o obs, e Entry, now time.Time) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if err := q.UpdateObservation(ctx, sqlcgen.UpdateObservationParams{FileID: o.FileID, RelPath: e.Rel, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
			return err
		}
		if err := q.SetVersionLocator(ctx, sqlcgen.SetVersionLocatorParams{FileID: o.FileID, Locator: e.Abs, Filename: path.Base(e.Rel)}); err != nil {
			return err
		}
		if err := q.SetCurrentVersionAvailable(ctx, sqlcgen.SetCurrentVersionAvailableParams{FileID: o.FileID, Available: true}); err != nil {
			return err
		}
		if err := q.TouchFingerprint(ctx, sqlcgen.TouchFingerprintParams{ContentVersion: o.ContentVersion, SizeBytes: e.Size, Mtime: e.Mtime, Now: now}); err != nil {
			return err
		}
		if err := q.DeleteCandidate(ctx, sqlcgen.DeleteCandidateParams{LibraryID: lib, RelPath: e.Rel}); err != nil {
			return err
		}
		return q.CloseReviewByKey(ctx, sqlcgen.CloseReviewByKeyParams{LibraryID: lib, Kind: "move", SubjectKey: *o.Sha256, Now: now})
	})
}

type moveCandidates struct {
	SHA256       string   `json:"sha256"`
	MissingFiles []string `json:"missingFiles"`
	MissingPaths []string `json:"missingPaths"`
	NewPaths     []string `json:"newPaths"`
}

// raiseMoveReview records (or refreshes) the single open question for these bytes.
func (s *Scanner) raiseMoveReview(ctx context.Context, lib uuid.UUID, sha string, missing []obs, newPaths []string) error {
	mc := moveCandidates{SHA256: sha, NewPaths: newPaths}
	for _, m := range missing {
		mc.MissingFiles = append(mc.MissingFiles, m.FileID.String())
		mc.MissingPaths = append(mc.MissingPaths, m.RelPath)
	}
	sort.Strings(mc.NewPaths)
	raw, err := json.Marshal(mc)
	if err != nil {
		return err
	}
	_, err = sqlcgen.New(s.Pool).UpsertOpenReview(ctx, sqlcgen.UpsertOpenReviewParams{LibraryID: lib, Kind: "move", SubjectKey: sha, Candidates: raw})
	return err
}
