package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// recordingProviderFields are the fields a recording review may offer (the editable recording fields).
var recordingProviderFields = map[string]bool{"title": true, "authors": true, "series_name": true, "series_index": true, "narrators": true,
	"publisher": true, "published": true, "isbn": true, "description": true}

// providerResultsWire converts a search outcome for the API, keeping only the fields the subject can edit.
func providerResultsWire(res metadata.SearchOutcome, allowed map[string]bool) []wire.T005ProviderResult {
	out := []wire.T005ProviderResult{}
	for _, r := range res.Results {
		pr := wire.T005ProviderResult{Provider: r.Provider, Status: r.Status, Cached: r.Cached, Candidates: []wire.T005ProviderCandidate{}}
		for _, c := range r.Candidates {
			fields := map[string]wire.T005MetadataValue{}
			for k, v := range c.Fields {
				if allowed[k] {
					fields[k] = wire.T005MetadataValue{Raw: v}
				}
			}
			pr.Candidates = append(pr.Candidates, wire.T005ProviderCandidate{ID: c.ID, ByIdentifier: c.ByIdentifier, Consistent: c.Consistent, Fields: fields})
		}
		out = append(out, pr)
	}
	return out
}

// registerRecordingProviders adds provider search for audiobook recordings (ADR-0049/0060).
func (a *API) registerRecordingProviders(api huma.API) {
	o := adminOp(op("searchRecordingProviders", http.MethodPost, "/admin/recordings/{recordingId}/metadata/provider-search", "Search the library's enabled metadata providers for candidates to review", "ingest"))
	o.Security = secured
	huma.Register(api, o, func(ctx context.Context, in *struct {
		RecordingID string `path:"recordingId" format:"uuid"`
		Body        wire.T005ProviderSearch
	}) (*bodyOut[wire.T005RecordingProviderSearchResults], error) {
		id := mustUUID(in.RecordingID)
		lib, err := a.Metadata.LibraryOf(ctx, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		_, stored, err := a.Enricher.RecordingQuery(ctx, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		q := stored
		if t := strings.TrimSpace(in.Body.Query.Title); t != "" {
			q.Title = t
		}
		if len(in.Body.Query.Authors) > 0 {
			q.Authors = nil
			for _, x := range in.Body.Query.Authors {
				if x = strings.TrimSpace(x); x != "" {
					q.Authors = append(q.Authors, x)
				}
			}
		}
		if x := strings.ToUpper(strings.TrimSpace(in.Body.Query.ISBN)); x != "" {
			if !providerISBN.MatchString(x) {
				return nil, a.fail(ctx, apperr.Validation("isbn must be 10 or 13 characters with no hyphens."))
			}
			q.ISBN = x
		}
		if x := strings.ToUpper(strings.TrimSpace(in.Body.Query.ASIN)); x != "" {
			if len(x) != 10 || strings.Trim(x, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") != "" {
				return nil, a.fail(ctx, apperr.Validation("asin must be 10 letters or digits."))
			}
			q.ASIN = x
		}
		res, err := a.Enricher.Search(ctx, lib, q, metadata.SearchOptions{Audio: true, Fresh: in.Body.Fresh})
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.T005RecordingProviderSearchResults]{Body: wire.T005RecordingProviderSearchResults{
			RecordingID: in.RecordingID, Enabled: res.Enabled,
			Query:   wire.T005ProviderQuery{Title: q.Title, Authors: q.Authors, ISBN: q.ISBN, ASIN: q.ASIN},
			Results: providerResultsWire(res, recordingProviderFields)}}, nil
	})
}

// registerRecordingAutoFill adds auto-fill for audiobook recordings (ADR-0060/0087).
func (a *API) registerRecordingAutoFill(api huma.API) {
	o := adminOp(op("autoFillRecordingMetadata", http.MethodPost, "/admin/recordings/{recordingId}/metadata/auto-fill", "Fill empty fields from an unambiguous identifier match", "ingest"))
	o.Security = secured
	huma.Register(api, o, func(ctx context.Context, in *struct {
		RecordingID string `path:"recordingId" format:"uuid"`
		DryRun      bool   `query:"dryRun" doc:"Return what would be filled without storing it, so it can be reviewed and saved (ADR-0090)."`
	}) (*bodyOut[wire.T005AutoFillResult], error) {
		id := mustUUID(in.RecordingID)
		lib, err := a.Metadata.LibraryOf(ctx, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		_, q, err := a.Enricher.RecordingQuery(ctx, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		res, err := a.Enricher.Search(ctx, lib, q, metadata.SearchOptions{Audio: true, Fresh: true})
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		fillsSomething := func(m metadata.Match) bool {
			gaps, err := a.Enricher.GapFields(ctx, id, m)
			if err != nil {
				return true
			}
			for k := range gaps {
				if recordingProviderFields[k] {
					return true
				}
			}
			return false
		}
		m, outcome, rule := metadata.PickAutoFill(res, q, "", fillsSomething)
		out := wire.T005AutoFillResult{Outcome: outcome, Filled: []string{}, Rule: rule}
		if outcome == "filled" && in.DryRun {
			gaps, err := a.Enricher.GapFields(ctx, id, m)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			out.Provider = m.Provider
			out.Proposed = map[string]wire.T005MetadataValue{}
			for k, v := range gaps {
				if recordingProviderFields[k] {
					out.Proposed[k] = wire.T005MetadataValue{Raw: v}
				}
			}
			out.Outcome = "proposed"
			if len(out.Proposed) == 0 {
				out.Outcome, out.Proposed = "nothing_to_fill", nil
			}
			return &bodyOut[wire.T005AutoFillResult]{Body: out}, nil
		}
		if outcome == "filled" {
			out.Provider = m.Provider
			filled, err := a.Enricher.ApplyMatch(ctx, id, m)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			if len(filled) == 0 {
				out.Outcome = "nothing_to_fill"
			} else {
				out.Filled = filled
			}
		}
		return &bodyOut[wire.T005AutoFillResult]{Body: out}, nil
	})
}
