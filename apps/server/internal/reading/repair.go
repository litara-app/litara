package reading

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Reviewed recording repair (ADR-0070). A plan names source recordings and an
// exact ordered partition of their file/version memberships. Applying creates
// new successor recordings and turns the sources into non-playable tombstones;
// file IDs, content versions and bytes never change, and no source state is
// overwritten or exposed to the administrator.

type planFile struct {
	FileID         string `json:"fileId"`
	ContentVersion string `json:"contentVersion"`
}

// planSource is the immutable reviewed layout of one source recording.
type planSource struct {
	RecordingID    string     `json:"recordingId"`
	LayoutRevision string     `json:"layoutRevision"`
	Files          []planFile `json:"files"`
}

func repairProblem(status int, code, detail string) *apperr.Error {
	return apperr.New(status, code, detail)
}

var genericWarnings = []wire.EditionIssue{{Code: "state_retained", Detail: "Source recordings become tombstones. Every account's position, completion and history stays with its source recording; positions are offered as explicit candidates on a successor only where their file belongs to it. Successors start unfinished."}}

func (s *Service) planWire(p sqlcgen.RepairPlan) (wire.RepairPlan, error) {
	var srcs []planSource
	if err := json.Unmarshal(p.Sources, &srcs); err != nil {
		return wire.RepairPlan{}, err
	}
	out := wire.RepairPlan{ID: p.ID.String(), Revision: strconv.FormatInt(p.Revision, 10), LibraryID: p.LibraryID.String(), TitleID: p.TitleID.String(),
		Kind: p.Kind, State: p.State, Sources: []wire.RepairSource{}, Outputs: []wire.RepairOutput{}, Result: []wire.RepairResult{}, Warnings: genericWarnings}
	for _, sr := range srcs {
		out.Sources = append(out.Sources, wire.RepairSource{RecordingID: sr.RecordingID, LayoutRevision: sr.LayoutRevision})
	}
	if err := json.Unmarshal(p.Outputs, &out.Outputs); err != nil {
		return out, err
	}
	if err := json.Unmarshal(p.Result, &out.Result); err != nil {
		return out, err
	}
	return out, nil
}

// RepairSourceLibrary returns the library of a plan's first source (for the
// administrator authority check before the plan is read).
func (s *Service) RepairSourceLibrary(ctx context.Context, w wire.RepairCreate) (uuid.UUID, error) {
	if len(w.Sources) == 0 {
		return uuid.Nil, apperr.Validation("sources must name at least one recording.")
	}
	id, err := parseUUID("sources[0].recordingId", w.Sources[0].RecordingID)
	if err != nil {
		return uuid.Nil, err
	}
	lib, err := s.q.GetRecordingLibrary(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, apperr.ErrNotFound
	}
	return lib, dbErr(err)
}

// RepairPlanLibrary returns a plan's library (404 when unknown).
func (s *Service) RepairPlanLibrary(ctx context.Context, id uuid.UUID) (uuid.UUID, error) {
	p, err := s.q.GetRepairPlan(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, apperr.ErrNotFound
	}
	return p.LibraryID, dbErr(err)
}

func (s *Service) GetRepair(ctx context.Context, id uuid.UUID) (wire.RepairPlan, error) {
	p, err := s.q.GetRepairPlan(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return wire.RepairPlan{}, apperr.ErrNotFound
	}
	if err != nil {
		return wire.RepairPlan{}, dbErr(err)
	}
	return s.planWire(p)
}

// snapshotSources locks the source recordings in UUID order and captures their
// current layouts; a problem means the sources are not repairable as named.
func (s *Service) snapshotSources(ctx context.Context, q *sqlcgen.Queries, refs []wire.RepairSource) ([]planSource, []sqlcgen.LockRecordingsForRepairRow, *apperr.Error, error) {
	ids := make([]uuid.UUID, 0, len(refs))
	want := map[uuid.UUID]string{}
	for _, r := range refs {
		id, err := parseUUID("recordingId", r.RecordingID)
		if err != nil {
			return nil, nil, nil, err
		}
		if _, err := parseUUID("layoutRevision", r.LayoutRevision); err != nil {
			return nil, nil, nil, err
		}
		if _, dup := want[id]; dup {
			return nil, nil, nil, apperr.Validation("A source recording appears twice.")
		}
		want[id] = r.LayoutRevision
		ids = append(ids, id)
	}
	rows, err := q.LockRecordingsForRepair(ctx, ids)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(rows) != len(ids) {
		return nil, nil, nil, apperr.ErrNotFound
	}
	files, err := q.ListRecordingFiles(ctx, ids)
	if err != nil {
		return nil, nil, nil, err
	}
	byRec := map[uuid.UUID][]planFile{}
	for _, f := range files {
		byRec[f.RecordingID] = append(byRec[f.RecordingID], planFile{FileID: f.FileID.String(), ContentVersion: f.ContentVersion.String()})
	}
	out := make([]planSource, 0, len(refs))
	byID := map[uuid.UUID]sqlcgen.LockRecordingsForRepairRow{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	for _, ref := range refs { // keep the caller's order for presentation
		id, _ := uuid.Parse(ref.RecordingID)
		r := byID[id]
		switch {
		case r.TombstonedAt != nil:
			return nil, nil, repairProblem(http.StatusPreconditionFailed, "recording_repaired", "A source recording was already repaired."), nil
		case r.LibraryID != byID[ids[0]].LibraryID || r.TitleID != byID[ids[0]].TitleID:
			return nil, nil, nil, apperr.Validation("All sources must belong to one library and one title.")
		case r.LayoutRevision.String() != want[id]:
			return nil, nil, repairProblem(http.StatusPreconditionFailed, "layout_changed", "A source recording layout changed; create a new plan."), nil
		case len(byRec[id]) == 0:
			return nil, nil, nil, apperr.Validation("A source recording has no files.")
		}
		out = append(out, planSource{RecordingID: ref.RecordingID, LayoutRevision: ref.LayoutRevision, Files: byRec[id]})
	}
	return out, rows, nil, nil
}

func fileKey(f planFile) string { return f.FileID + "@" + f.ContentVersion }

// validateOutputs checks the exact one-to-one partition of source memberships.
func validateOutputs(kind string, srcs []planSource, outs []wire.RepairOutput) error {
	switch kind {
	case "merge":
		if len(srcs) < 2 || len(outs) != 1 {
			return apperr.Validation("A merge needs at least two sources and exactly one output.")
		}
	case "split":
		if len(srcs) != 1 || len(outs) < 2 {
			return apperr.Validation("A split needs exactly one source and at least two outputs.")
		}
	default:
		return apperr.Validation("kind must be merge or split.")
	}
	owner := map[string]string{} // file key -> source recording
	byFile := map[string]bool{}  // file id alone (a file may not be in two sources)
	for _, sr := range srcs {
		for _, f := range sr.Files {
			if byFile[f.FileID] {
				return apperr.Validation("A file belongs to more than one source recording.")
			}
			byFile[f.FileID] = true
			owner[fileKey(f)] = sr.RecordingID
		}
	}
	keys := map[string]bool{}
	seen := map[string]bool{}
	for _, o := range outs {
		if strings.TrimSpace(o.Key) == "" || strings.TrimSpace(o.Label) == "" || len(o.Files) == 0 {
			return apperr.Validation("Every output needs a key, a label and at least one file.")
		}
		if keys[o.Key] {
			return apperr.Validation("Output keys must be unique.")
		}
		keys[o.Key] = true
		for _, f := range o.Files {
			if _, err := parseUUID("files.fileId", f.FileID); err != nil {
				return err
			}
			if _, err := parseUUID("files.contentVersion", f.ContentVersion); err != nil {
				return err
			}
			k := fileKey(planFile(f))
			if _, ok := owner[k]; !ok {
				return apperr.Validation("An output names a file or version that is not a member of the sources.")
			}
			if seen[k] {
				return apperr.Validation("A file appears in more than one output position.")
			}
			seen[k] = true
		}
	}
	if len(seen) != len(owner) {
		return apperr.Validation("The outputs must cover every source file exactly once.")
	}
	return nil
}

// PlanRepair records a reviewed plan; it changes nothing else.
func (s *Service) PlanRepair(ctx context.Context, a Actor, w wire.RepairCreate) (wire.RepairPlan, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.RepairPlan{}, err
	}
	ids := make([]uuid.UUID, 0, len(w.Sources))
	for _, r := range w.Sources {
		id, err := parseUUID("recordingId", r.RecordingID)
		if err != nil {
			return wire.RepairPlan{}, err
		}
		ids = append(ids, id)
	}
	fp := fingerprint(http.MethodPost, "/admin/recording-repairs", w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		_, err := q.LockRecordingsForRepair(ctx, ids)
		return err
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		srcs, rows, d, err := s.snapshotSources(ctx, q, w.Sources)
		if err != nil || d != nil {
			return nil, d, err
		}
		if err := validateOutputs(w.Kind, srcs, w.Outputs); err != nil {
			return nil, nil, err
		}
		sb, _ := json.Marshal(srcs)
		ob, _ := json.Marshal(w.Outputs)
		p, err := q.InsertRepairPlan(ctx, sqlcgen.InsertRepairPlanParams{AdminID: a.UserID, LibraryID: rows[0].LibraryID, TitleID: rows[0].TitleID,
			Kind: w.Kind, Sources: sb, Outputs: ob})
		if err != nil {
			return nil, nil, err
		}
		pw, err := s.planWire(p)
		return wire.Raw(pw), nil, err
	})
	if err != nil {
		return wire.RepairPlan{}, err
	}
	var out wire.RepairPlan
	return out, json.Unmarshal(body, &out)
}

// revalidate rechecks every source against the reviewed layout; a problem marks the plan stale.
func (s *Service) revalidate(ctx context.Context, q *sqlcgen.Queries, p sqlcgen.RepairPlan) ([]sqlcgen.LockRecordingsForRepairRow, []planSource, *apperr.Error, error) {
	var stored []planSource
	if err := json.Unmarshal(p.Sources, &stored); err != nil {
		return nil, nil, nil, err
	}
	refs := make([]wire.RepairSource, 0, len(stored))
	for _, sr := range stored {
		refs = append(refs, wire.RepairSource{RecordingID: sr.RecordingID, LayoutRevision: sr.LayoutRevision})
	}
	cur, rows, d, err := s.snapshotSources(ctx, q, refs)
	if err != nil || d != nil {
		return nil, nil, d, err
	}
	for i := range cur {
		a, b := keysOf(cur[i].Files), keysOf(stored[i].Files)
		if strings.Join(a, ",") != strings.Join(b, ",") {
			return nil, nil, repairProblem(http.StatusPreconditionFailed, "content_changed", "A source file or version changed; create a new plan."), nil
		}
	}
	return rows, cur, nil, nil
}

func keysOf(fs []planFile) []string {
	k := make([]string, 0, len(fs))
	for _, f := range fs {
		k = append(k, fileKey(f))
	}
	sort.Strings(k)
	return k
}

// repairStep runs approve, execute or cancel under plan and source locks.
func (s *Service) repairStep(ctx context.Context, a Actor, planID uuid.UUID, step string, w wire.RepairApply) (wire.RepairPlan, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.RepairPlan{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.RepairPlan{}, err
	}
	if _, err := s.RepairPlanLibrary(ctx, planID); err != nil {
		return wire.RepairPlan{}, err
	}
	fp := fingerprint(http.MethodPost, "/admin/recording-repairs/"+planID.String()+"/"+step, w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		_, err := q.LockRepairPlan(ctx, planID)
		return err
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		p, err := q.LockRepairPlan(ctx, planID)
		if err != nil {
			return nil, nil, err
		}
		if base != p.Revision {
			return nil, apperr.New(http.StatusConflict, "stale_revision", "The plan changed since that revision.").With("currentRevision", strconv.FormatInt(p.Revision, 10)), nil
		}
		wrongState := func(want string) (*apperr.Error, error) {
			return apperr.New(http.StatusConflict, "plan_state", "The plan is "+p.State+", not "+want+"."), nil
		}
		var result []wire.RepairResult
		next := p.State
		switch step {
		case "approve":
			if p.State != "planned" {
				d, e := wrongState("planned")
				return nil, d, e
			}
			if _, _, d, err := s.revalidate(ctx, q, p); err != nil || d != nil {
				if d != nil {
					_ = q.UpdateRepairPlan(ctx, sqlcgen.UpdateRepairPlanParams{ID: p.ID, State: "stale", Result: p.Result})
				}
				return nil, d, err
			}
			next = "approved"
		case "cancel":
			if p.State != "planned" && p.State != "approved" {
				d, e := wrongState("planned or approved")
				return nil, d, e
			}
			next = "cancelled"
		case "execute":
			if p.State != "approved" {
				d, e := wrongState("approved")
				return nil, d, e
			}
			rows, srcs, d, err := s.revalidate(ctx, q, p) // approval never waives revalidation
			if err != nil || d != nil {
				if d != nil {
					_ = q.UpdateRepairPlan(ctx, sqlcgen.UpdateRepairPlanParams{ID: p.ID, State: "stale", Result: p.Result})
				}
				return nil, d, err
			}
			if result, err = s.applyRepair(ctx, q, p, rows, srcs); err != nil {
				return nil, nil, err
			}
			next = "applied"
		}
		rb := []byte("[]")
		if result != nil {
			rb = wire.Raw(result)
		} else {
			rb = p.Result
		}
		if err := q.UpdateRepairPlan(ctx, sqlcgen.UpdateRepairPlanParams{ID: p.ID, State: next, Result: rb}); err != nil {
			return nil, nil, err
		}
		np, err := q.GetRepairPlan(ctx, p.ID)
		if err != nil {
			return nil, nil, err
		}
		pw, err := s.planWire(np)
		return wire.Raw(pw), nil, err
	})
	if err != nil {
		return wire.RepairPlan{}, err
	}
	var out wire.RepairPlan
	return out, json.Unmarshal(body, &out)
}

func (s *Service) ApproveRepair(ctx context.Context, a Actor, id uuid.UUID, w wire.RepairApply) (wire.RepairPlan, error) {
	return s.repairStep(ctx, a, id, "approve", w)
}

func (s *Service) ExecuteRepair(ctx context.Context, a Actor, id uuid.UUID, w wire.RepairApply) (wire.RepairPlan, error) {
	return s.repairStep(ctx, a, id, "execute", w)
}

func (s *Service) CancelRepair(ctx context.Context, a Actor, id uuid.UUID, w wire.RepairApply) (wire.RepairPlan, error) {
	return s.repairStep(ctx, a, id, "cancel", w)
}

// applyRepair creates the successors and tombstones the sources in the caller's
// transaction. Sources are already locked (UUID order) and revalidated.
func (s *Service) applyRepair(ctx context.Context, q *sqlcgen.Queries, p sqlcgen.RepairPlan, rows []sqlcgen.LockRecordingsForRepairRow, srcs []planSource) ([]wire.RepairResult, error) {
	var outs []wire.RepairOutput
	if err := json.Unmarshal(p.Outputs, &outs); err != nil {
		return nil, err
	}
	srcByID := map[uuid.UUID]sqlcgen.LockRecordingsForRepairRow{}
	for _, r := range rows {
		srcByID[r.ID] = r
	}
	fileSource := map[string]uuid.UUID{} // file key -> source recording
	for _, sr := range srcs {
		id, _ := uuid.Parse(sr.RecordingID)
		for _, f := range sr.Files {
			fileSource[fileKey(f)] = id
		}
	}
	// Chapter evidence of every source, to be rederived per successor.
	type chapter struct {
		source string
		starts []json.RawMessage
		fileID string
	}
	chaptersBySource := map[uuid.UUID][]sqlcgen.ChapterSource{}
	for _, sr := range srcs {
		id, _ := uuid.Parse(sr.RecordingID)
		cs, err := q.ListChapterSources(ctx, id)
		if err != nil {
			return nil, err
		}
		chaptersBySource[id] = cs
	}
	positions, err := q.ListSourcePositions(ctx, func() []uuid.UUID {
		ids := make([]uuid.UUID, 0, len(srcs))
		for _, sr := range srcs {
			id, _ := uuid.Parse(sr.RecordingID)
			ids = append(ids, id)
		}
		return ids
	}())
	if err != nil {
		return nil, err
	}
	now := s.now()
	results := make([]wire.RepairResult, 0, len(outs))
	successorIDs := make([]uuid.UUID, 0, len(outs))
	for _, o := range outs {
		sid := uuid.New()
		// Artwork and narrators come from the first source that has them.
		first := srcByID[mustParse(srcs[0].RecordingID)]
		narrators := []string{}
		seenN := map[string]bool{}
		for _, f := range o.Files {
			for _, n := range srcByID[fileSource[fileKey(planFile(f))]].Narrators {
				if !seenN[n] {
					seenN[n] = true
					narrators = append(narrators, n)
				}
			}
		}
		layout, err := q.InsertSuccessorRecording(ctx, sqlcgen.InsertSuccessorRecordingParams{ID: sid, TitleID: p.TitleID, LibraryID: p.LibraryID, Narrators: narrators,
			ThumbnailLocator: first.ThumbnailLocator, ThumbnailMime: first.ThumbnailMime, CoverLocator: first.CoverLocator, CoverMime: first.CoverMime})
		if err != nil {
			return nil, err
		}
		inOutput := map[string]bool{}
		for i, f := range o.Files {
			fid, _ := uuid.Parse(f.FileID)
			if err := q.InsertRecordingFile(ctx, sqlcgen.InsertRecordingFileParams{RecordingID: sid, Sequence: int32(i), FileID: fid}); err != nil {
				return nil, err
			}
			inOutput[fileKey(planFile(f))] = true
		}
		// Chapters: keep each source's evidence (user edits included) that points at a file of this output.
		bySourceKind := map[string][]catalogStart{}
		order := []string{}
		for _, sr := range srcs {
			id := mustParse(sr.RecordingID)
			for _, c := range chaptersBySource[id] {
				var starts []catalogStart
				if json.Unmarshal(c.Starts, &starts) != nil {
					continue
				}
				for _, st := range starts {
					if inOutput[st.FileID.String()+"@"+st.ContentVersion.String()] {
						if _, ok := bySourceKind[c.Source]; !ok {
							order = append(order, c.Source)
						}
						bySourceKind[c.Source] = append(bySourceKind[c.Source], st)
					}
				}
			}
		}
		for _, kind := range order {
			if err := q.InsertChapterSource(ctx, sqlcgen.InsertChapterSourceParams{RecordingID: sid, Source: kind, Starts: wire.Raw(bySourceKind[kind])}); err != nil {
				return nil, err
			}
		}
		// Explicit position candidates: only where the source position's file/version belongs here.
		for _, ps := range positions {
			k := ps.FileID.UUID.String() + "@" + ps.ContentVersion.UUID.String()
			if !inOutput[k] {
				continue
			}
			ok, err := q.HasGrant(ctx, sqlcgen.HasGrantParams{UserID: ps.UserID, LibraryID: p.LibraryID})
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
			dev := ""
			if ps.DeviceName != nil {
				dev = *ps.DeviceName
			}
			cand := wire.Position{FileID: ps.FileID.UUID.String(), ContentVersion: ps.ContentVersion.UUID.String(), OffsetMs: *ps.OffsetMs,
				LayoutRevision: layout.String(), CapturedAt: rfc(*ps.CapturedAt), ReceivedAt: rfc(*ps.ReceivedAt), DeviceName: dev}
			if _, err := q.InsertConflict(ctx, sqlcgen.InsertConflictParams{UserID: ps.UserID, RecordingID: sid, Kind: "position", Reason: "repair_source",
				OperationID: p.ID, Candidate: wire.Raw(cand), BaseRevision: 0, LayoutRevision: uuid.NullUUID{UUID: layout, Valid: true}, CreatedAt: now}); err != nil {
				return nil, err
			}
		}
		successorIDs = append(successorIDs, sid)
		results = append(results, wire.RepairResult{Key: o.Key, RecordingID: sid.String()})
	}
	for _, sr := range srcs {
		id := mustParse(sr.RecordingID)
		// A source points at the successors that took its files.
		var mine []uuid.UUID
		for i, o := range outs {
			for _, f := range o.Files {
				if fileSource[fileKey(planFile(f))] == id {
					mine = append(mine, successorIDs[i])
					break
				}
			}
		}
		if err := q.TombstoneRecording(ctx, sqlcgen.TombstoneRecordingParams{ID: id, SuccessorIds: mine}); err != nil {
			return nil, err
		}
	}
	return results, nil
}

type catalogStart struct {
	FileID         uuid.UUID `json:"fileId"`
	ContentVersion uuid.UUID `json:"contentVersion"`
	OffsetMs       int64     `json:"offsetMs"`
	Label          string    `json:"label"`
}

func mustParse(s string) uuid.UUID { id, _ := uuid.Parse(s); return id }
