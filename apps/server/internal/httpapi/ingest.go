package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/deranjer/ebooker/apps/server/internal/jobs"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// manage enforces administrator status plus a grant on the library (ADR-0056).
func (a *API) manage(ctx context.Context, lib uuid.UUID) error {
	p := principal(ctx)
	return a.fail2(ctx, a.Library.Authorize(ctx, p.UserID, p.IsAdmin, lib))
}

func (a *API) fail2(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	return a.fail(ctx, err)
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func tsp(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := ts(*t)
	return &s
}

func toScanRun(r sqlcgen.ScanRun) wire.ScanRun {
	return wire.ScanRun{ID: r.ID.String(), LibraryID: r.LibraryID.String(), Trigger: r.Trigger, State: r.State, Health: r.Health,
		FilesSeen: int(r.FilesSeen), CreatedAt: ts(r.CreatedAt), CompletedAt: tsp(r.CompletedAt), Failure: r.Failure}
}

type libIn struct {
	LibraryID string `path:"libraryId" format:"uuid"`
}

func (a *API) registerIngest(api huma.API) {
	// ---- scans ----
	ss := adminOp(op("startScan", http.MethodPost, "/admin/libraries/{libraryId}/scans", "Request a scan (or a verification pass)", "ingest"))
	ss.Security, ss.DefaultStatus = secured, http.StatusAccepted
	huma.Register(api, ss, func(ctx context.Context, in *struct {
		LibraryID string `path:"libraryId" format:"uuid"`
		Body      wire.StartScan
	}) (*bodyOut[wire.ScanRun], error) {
		lib := mustUUID(in.LibraryID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		trigger := "manual"
		if in.Body.Verify {
			trigger = "verify"
		}
		run, created, err := jobs.RequestScan(ctx, a.Pool, a.Jobs, lib, trigger)
		if err != nil {
			return nil, a.fail(ctx, apperr.ErrUnavailable)
		}
		if !created {
			return nil, a.fail(ctx, apperr.New(http.StatusConflict, "scan_active", "A scan is already queued or running for this library."))
		}
		return &bodyOut[wire.ScanRun]{Body: toScanRun(run)}, nil
	})

	ls := adminOp(op("listScans", http.MethodGet, "/admin/libraries/{libraryId}/scans", "Recent scans and their root health", "ingest"))
	huma.Register(api, ls, func(ctx context.Context, in *libIn) (*bodyOut[wire.ScanRunList], error) {
		lib := mustUUID(in.LibraryID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		rows, err := sqlcgen.New(a.Pool).ListScanRuns(ctx, lib)
		if err != nil {
			return nil, a.fail(ctx, apperr.ErrUnavailable)
		}
		out := wire.ScanRunList{Items: []wire.ScanRun{}}
		for _, r := range rows {
			out.Items = append(out.Items, toScanRun(r))
		}
		return &bodyOut[wire.ScanRunList]{Body: out}, nil
	})

	// ---- reviews ----
	lr := adminOp(op("listReviews", http.MethodGet, "/admin/libraries/{libraryId}/reviews", "Open review items", "ingest"))
	huma.Register(api, lr, func(ctx context.Context, in *libIn) (*bodyOut[wire.ReviewList], error) {
		lib := mustUUID(in.LibraryID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		rows, err := sqlcgen.New(a.Pool).ListOpenReviews(ctx, lib)
		if err != nil {
			return nil, a.fail(ctx, apperr.ErrUnavailable)
		}
		out := wire.ReviewList{Items: []wire.Review{}}
		for _, r := range rows {
			c := map[string]any{}
			_ = json.Unmarshal(r.Candidates, &c)
			out.Items = append(out.Items, wire.Review{ID: r.ID.String(), Kind: r.Kind, SubjectKey: r.SubjectKey, Candidates: c, CreatedAt: ts(r.CreatedAt)})
		}
		return &bodyOut[wire.ReviewList]{Body: out}, nil
	})

	rr := adminOp(op("resolveReview", http.MethodPost, "/admin/libraries/{libraryId}/reviews/{reviewId}/resolve", "Resolve a review item", "ingest"))
	rr.Security, rr.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, rr, func(ctx context.Context, in *struct {
		LibraryID string `path:"libraryId" format:"uuid"`
		ReviewID  string `path:"reviewId" format:"uuid"`
		Body      wire.ReviewResolution
	}) (*noContent, error) {
		lib, id := mustUUID(in.LibraryID), mustUUID(in.ReviewID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		item, err := sqlcgen.New(a.Pool).GetReviewItem(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && item.LibraryID != lib) {
			return nil, a.fail(ctx, apperr.ErrNotFound)
		}
		if err != nil {
			return nil, a.fail(ctx, apperr.ErrUnavailable)
		}
		by := principal(ctx).UserID
		b := in.Body
		if item.Kind == "provider" {
			if item.State != "open" {
				return nil, a.fail(ctx, apperr.New(http.StatusConflict, "review_closed", "This review item is already resolved."))
			}
			if err := a.Enricher.ResolveProvider(ctx, item.Candidates, b.Action, b.Index); err != nil {
				return nil, a.fail(ctx, err)
			}
			return nil, a.fail2(ctx, a.Scanner.CloseReview(ctx, id, by, map[string]any{"action": b.Action, "index": b.Index}))
		}
		err = a.Scanner.ResolveReview(ctx, lib, id, by, ingest.Resolution{Action: b.Action, Missing: b.MissingFileID, NewPath: b.NewPath,
			Files: b.Files, TitleID: b.TitleID, Path: b.Path})
		return nil, a.fail2(ctx, err)
	})

	// ---- metadata ----
	type recIn struct {
		RecordingID string `path:"recordingId" format:"uuid"`
	}
	recAuth := func(ctx context.Context, id uuid.UUID) error {
		lib, err := a.Metadata.LibraryOf(ctx, id)
		if err != nil {
			return a.fail(ctx, err)
		}
		return a.manage(ctx, lib)
	}
	gm := adminOp(op("getRecordingMetadata", http.MethodGet, "/admin/recordings/{recordingId}/metadata", "Effective metadata with provenance and suppressed conflicts", "ingest"))
	huma.Register(api, gm, func(ctx context.Context, in *recIn) (*bodyOut[wire.MetadataReport], error) {
		id := mustUUID(in.RecordingID)
		if err := recAuth(ctx, id); err != nil {
			return nil, err
		}
		rep, err := a.Metadata.Report(ctx, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		names := make([]string, 0, len(rep))
		for f := range rep {
			names = append(names, f)
		}
		sort.Strings(names)
		out := wire.MetadataReport{Fields: []wire.MetadataField{}}
		for _, f := range names {
			e := rep[f]
			mf := wire.MetadataField{Field: f, Source: e.Source, Cleared: e.Cleared, Value: e.Raw}
			for _, c := range e.Conflicts {
				mf.Conflicts = append(mf.Conflicts, wire.MetadataConflict{Source: c.Source, Value: c.Raw})
			}
			out.Fields = append(out.Fields, mf)
		}
		return &bodyOut[wire.MetadataReport]{Body: out}, nil
	})

	pm := adminOp(op("setRecordingMetadata", http.MethodPut, "/admin/recordings/{recordingId}/metadata/{field}", "Set a protected edit or a protected clear", "ingest"))
	pm.Security, pm.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, pm, func(ctx context.Context, in *struct {
		RecordingID string `path:"recordingId" format:"uuid"`
		Field       string `path:"field" enum:"title,authors,series_name,series_index,narrators"`
		Body        wire.SetMetadata
	}) (*noContent, error) {
		id := mustUUID(in.RecordingID)
		if err := recAuth(ctx, id); err != nil {
			return nil, err
		}
		if in.Body.Clear == (len(in.Body.Value) > 0) {
			return nil, a.fail(ctx, apperr.Validation("send exactly one of value or clear"))
		}
		var raw json.RawMessage
		if !in.Body.Clear {
			raw = in.Body.Value
		}
		return nil, a.fail2(ctx, a.Metadata.SetUser(ctx, id, in.Field, raw))
	})

	dm := adminOp(op("removeRecordingMetadata", http.MethodDelete, "/admin/recordings/{recordingId}/metadata/{field}", "Remove a protected edit so other sources apply again", "ingest"))
	dm.Security, dm.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, dm, func(ctx context.Context, in *struct {
		RecordingID string `path:"recordingId" format:"uuid"`
		Field       string `path:"field" enum:"title,authors,series_name,series_index,narrators"`
	}) (*noContent, error) {
		id := mustUUID(in.RecordingID)
		if err := recAuth(ctx, id); err != nil {
			return nil, err
		}
		return nil, a.fail2(ctx, a.Metadata.RemoveUser(ctx, id, in.Field))
	})

	a.registerImports(api)
	a.registerWriteback(api)
}

// ---- imports --------------------------------------------------------------------------

func toImportPlan(p sqlcgen.ImportPlan, items []sqlcgen.ImportItem) wire.ImportPlan {
	out := wire.ImportPlan{ID: p.ID.String(), LibraryID: p.LibraryID.String(), SourcePath: p.SourcePath, State: p.State, Items: []wire.ImportItem{}}
	for _, it := range items {
		wi := wire.ImportItem{ID: it.ID.String(), SourceRel: it.SourceRel, SizeBytes: it.SizeBytes, TargetRel: it.TargetRel, Suffixed: it.Suffixed,
			Decision: it.Decision, State: it.State, Detail: it.Detail}
		if it.DuplicateOf.Valid {
			s := it.DuplicateOf.UUID.String()
			wi.DuplicateOf = &s
		}
		out.Items = append(out.Items, wi)
	}
	return out
}

func (a *API) registerImports(api huma.API) {
	type planPath struct {
		LibraryID string `path:"libraryId" format:"uuid"`
		PlanID    string `path:"planId" format:"uuid"`
	}
	load := func(ctx context.Context, lib, plan uuid.UUID) (sqlcgen.ImportPlan, error) {
		p, err := sqlcgen.New(a.Pool).GetImportPlanFor(ctx, sqlcgen.GetImportPlanForParams{ID: plan, LibraryID: lib})
		if errors.Is(err, pgx.ErrNoRows) {
			return p, a.fail(ctx, apperr.ErrNotFound)
		}
		if err != nil {
			return p, a.fail(ctx, apperr.ErrUnavailable)
		}
		return p, nil
	}

	cp := adminOp(op("planImport", http.MethodPost, "/admin/libraries/{libraryId}/imports", "Plan a copy-only import for review (nothing is copied)", "ingest"))
	cp.Security, cp.DefaultStatus = secured, http.StatusCreated
	huma.Register(api, cp, func(ctx context.Context, in *struct {
		LibraryID string `path:"libraryId" format:"uuid"`
		Body      wire.PlanImport
	}) (*bodyOut[wire.ImportPlan], error) {
		lib := mustUUID(in.LibraryID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		p, items, err := a.Importer.Plan(ctx, lib, in.Body.SourcePath, principal(ctx).UserID)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.ImportPlan]{Body: toImportPlan(p, items)}, nil
	})

	gp := adminOp(op("getImport", http.MethodGet, "/admin/libraries/{libraryId}/imports/{planId}", "Read an import plan and item progress", "ingest"))
	huma.Register(api, gp, func(ctx context.Context, in *planPath) (*bodyOut[wire.ImportPlan], error) {
		lib := mustUUID(in.LibraryID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		p, err := load(ctx, lib, mustUUID(in.PlanID))
		if err != nil {
			return nil, err
		}
		items, err := sqlcgen.New(a.Pool).ListImportItems(ctx, p.ID)
		if err != nil {
			return nil, a.fail(ctx, apperr.ErrUnavailable)
		}
		return &bodyOut[wire.ImportPlan]{Body: toImportPlan(p, items)}, nil
	})

	di := adminOp(op("decideImportItem", http.MethodPut, "/admin/libraries/{libraryId}/imports/{planId}/items/{itemId}", "Import or skip one item (for example keep a duplicate)", "ingest"))
	di.Security, di.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, di, func(ctx context.Context, in *struct {
		LibraryID string `path:"libraryId" format:"uuid"`
		PlanID    string `path:"planId" format:"uuid"`
		ItemID    string `path:"itemId" format:"uuid"`
		Body      wire.ImportDecision
	}) (*noContent, error) {
		lib := mustUUID(in.LibraryID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		p, err := load(ctx, lib, mustUUID(in.PlanID))
		if err != nil {
			return nil, err
		}
		return nil, a.fail2(ctx, a.Importer.SetDecision(ctx, p.ID, mustUUID(in.ItemID), in.Body.Decision))
	})

	ap := adminOp(op("approveImport", http.MethodPost, "/admin/libraries/{libraryId}/imports/{planId}/approve", "Approve the plan (pending items become imports)", "ingest"))
	ap.Security, ap.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, ap, func(ctx context.Context, in *planPath) (*noContent, error) {
		lib := mustUUID(in.LibraryID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		p, err := load(ctx, lib, mustUUID(in.PlanID))
		if err != nil {
			return nil, err
		}
		return nil, a.fail2(ctx, a.Importer.Approve(ctx, p.ID, principal(ctx).UserID))
	})

	ex := adminOp(op("executeImport", http.MethodPost, "/admin/libraries/{libraryId}/imports/{planId}/execute", "Queue the copy of an approved plan (safe to repeat)", "ingest"))
	ex.Security, ex.DefaultStatus = secured, http.StatusAccepted
	huma.Register(api, ex, func(ctx context.Context, in *planPath) (*noContent, error) {
		lib := mustUUID(in.LibraryID)
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		p, err := load(ctx, lib, mustUUID(in.PlanID))
		if err != nil {
			return nil, err
		}
		if p.State != "approved" && p.State != "running" {
			return nil, a.fail(ctx, apperr.New(http.StatusConflict, "plan_not_runnable", "Only an approved plan can be executed."))
		}
		err = pgx.BeginFunc(ctx, a.Pool, func(tx pgx.Tx) error { return a.Jobs.EnqueueImport(ctx, tx, p.ID) })
		return nil, a.fail2(ctx, err)
	})
}

// ---- write-back ----------------------------------------------------------------------

func toWriteback(p sqlcgen.WritebackPlan) wire.Writeback {
	return wire.Writeback{ID: p.ID.String(), LibraryID: p.LibraryID.String(), Kind: p.Kind, Format: p.Format, Target: p.TargetRel, Stage: p.Stage,
		Detail: p.Detail, BackedUp: p.BackupRef != nil && *p.BackupRef != "", Diff: p.Diff}
}

func (a *API) registerWriteback(api huma.API) {
	type wbPath struct {
		PlanID string `path:"planId" format:"uuid"`
	}
	load := func(ctx context.Context, id uuid.UUID) (sqlcgen.WritebackPlan, error) {
		p, err := sqlcgen.New(a.Pool).GetWritebackPlan(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return p, a.fail(ctx, apperr.ErrNotFound)
		}
		if err != nil {
			return p, a.fail(ctx, apperr.ErrUnavailable)
		}
		return p, a.manage(ctx, p.LibraryID)
	}

	ps := adminOp(op("planSidecarExport", http.MethodPost, "/admin/recordings/{recordingId}/writebacks/sidecar", "Plan a Litara JSON sidecar export for review", "ingest"))
	ps.Security, ps.DefaultStatus = secured, http.StatusCreated
	huma.Register(api, ps, func(ctx context.Context, in *struct {
		RecordingID string `path:"recordingId" format:"uuid"`
	}) (*bodyOut[wire.Writeback], error) {
		id := mustUUID(in.RecordingID)
		lib, err := a.Metadata.LibraryOf(ctx, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		p, err := a.Writeback.PlanSidecar(ctx, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.Writeback]{Body: toWriteback(p)}, nil
	})

	pf := adminOp(op("planInFileWrite", http.MethodPost, "/admin/files/{fileId}/writebacks", "Plan an in-file metadata write (only for formats with recorded fidelity evidence)", "ingest"))
	pf.Security, pf.DefaultStatus = secured, http.StatusCreated
	huma.Register(api, pf, func(ctx context.Context, in *struct {
		FileID string `path:"fileId" format:"uuid"`
		Body   wire.PlanInFile
	}) (*bodyOut[wire.Writeback], error) {
		fid := mustUUID(in.FileID)
		lib, err := sqlcgen.New(a.Pool).GetFileLibrary(ctx, fid)
		if err != nil {
			return nil, a.fail(ctx, apperr.ErrNotFound)
		}
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		changes := metadata.Fields{}
		for k, v := range in.Body.Changes {
			if !metadata.Valid(k) {
				return nil, a.fail(ctx, apperr.Validation("unknown field "+k))
			}
			changes[k] = v
		}
		p, err := a.Writeback.PlanInFile(ctx, fid, changes)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.Writeback]{Body: toWriteback(p)}, nil
	})

	gw := adminOp(op("getWriteback", http.MethodGet, "/admin/writebacks/{planId}", "Read a write-back plan and its journal stage", "ingest"))
	huma.Register(api, gw, func(ctx context.Context, in *wbPath) (*bodyOut[wire.Writeback], error) {
		p, err := load(ctx, mustUUID(in.PlanID))
		if err != nil {
			return nil, err
		}
		return &bodyOut[wire.Writeback]{Body: toWriteback(p)}, nil
	})

	aw := adminOp(op("approveWriteback", http.MethodPost, "/admin/writebacks/{planId}/approve", "Approve exactly this diff", "ingest"))
	aw.Security, aw.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, aw, func(ctx context.Context, in *wbPath) (*noContent, error) {
		p, err := load(ctx, mustUUID(in.PlanID))
		if err != nil {
			return nil, err
		}
		return nil, a.fail2(ctx, a.Writeback.Approve(ctx, p.ID, principal(ctx).UserID))
	})

	xw := adminOp(op("executeWriteback", http.MethodPost, "/admin/writebacks/{planId}/execute", "Run an approved write (staged, validated, journaled)", "ingest"))
	xw.Security = secured
	huma.Register(api, xw, func(ctx context.Context, in *wbPath) (*bodyOut[wire.Writeback], error) {
		p, err := load(ctx, mustUUID(in.PlanID))
		if err != nil {
			return nil, err
		}
		if err := a.Writeback.Execute(ctx, p.ID); err != nil {
			return nil, a.fail(ctx, err)
		}
		done, err := sqlcgen.New(a.Pool).GetWritebackPlan(ctx, p.ID)
		if err != nil {
			return nil, a.fail(ctx, apperr.ErrUnavailable)
		}
		return &bodyOut[wire.Writeback]{Body: toWriteback(done)}, nil
	})

	lw := adminOp(op("listWriters", http.MethodGet, "/admin/writers", "In-file writer enablement per format (all off until fidelity evidence exists)", "ingest"))
	huma.Register(api, lw, func(ctx context.Context, _ *struct{}) (*bodyOut[wire.WriterCapabilityList], error) {
		out := wire.WriterCapabilityList{Items: []wire.WriterCapability{}}
		for _, f := range []string{"epub", "mp3", "flac", "m4a", "m4b"} {
			c, err := sqlcgen.New(a.Pool).GetWriterCapability(ctx, f)
			if err != nil {
				return nil, a.fail(ctx, apperr.ErrUnavailable)
			}
			out.Items = append(out.Items, wire.WriterCapability{Format: f, Enabled: c.Enabled})
		}
		return &bodyOut[wire.WriterCapabilityList]{Body: out}, nil
	})
}
