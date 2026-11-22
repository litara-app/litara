package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

var providerISBN = regexp.MustCompile(`^(\d{9}[\dX]|\d{13})$`)

// editionProviderFields are the fields an edition review may offer; others a provider returns are dropped.
var editionProviderFields = map[string]bool{"title": true, "authors": true, "series_name": true, "series_index": true, "language": true,
	"tags": true, "publisher": true, "published": true, "page_count": true, "isbn": true, "description": true,
	"subtitle": true, "genres": true, "age_rating": true, "open_library_id": true, "google_books_id": true, "hardcover_id": true,
	"public_rating": true, "public_rating_count": true}

// providerQuery builds the only data sent to providers: the request's members, else the effective title, authors and ISBN.
func providerQuery(rep wire.T005MetadataReport, in wire.T005ProviderQuery) (wire.T005ProviderQuery, error) {
	out := wire.T005ProviderQuery{Title: strings.TrimSpace(in.Title), ISBN: strings.ToUpper(strings.TrimSpace(in.ISBN))}
	for _, a := range in.Authors {
		if a = strings.TrimSpace(a); a != "" {
			out.Authors = append(out.Authors, a)
		}
	}
	if out.ISBN != "" && !providerISBN.MatchString(out.ISBN) {
		return out, apperr.Validation("isbn must be 10 or 13 characters with no hyphens.")
	}
	for _, f := range rep.Fields {
		if f.Cleared {
			continue
		}
		switch {
		case f.Field == "title" && out.Title == "":
			_ = json.Unmarshal(f.Value.Raw, &out.Title)
		case f.Field == "authors" && len(out.Authors) == 0:
			_ = json.Unmarshal(f.Value.Raw, &out.Authors)
		case f.Field == "isbn" && out.ISBN == "":
			_ = json.Unmarshal(f.Value.Raw, &out.ISBN)
		}
	}
	return out, nil
}

// manageEdition requires administrator status AND a grant on the edition library.
func (a *API) manageEdition(ctx context.Context, id string) error {
	lib, err := a.Reading.EditionLibrary(ctx, mustUUID(id))
	if err != nil {
		return a.fail(ctx, err)
	}
	return a.manage(ctx, lib)
}

type MetadataFieldIn struct {
	EditionID string `path:"editionId" format:"uuid"`
	Field     string `path:"field" enum:"title,authors,series_name,series_index,language,tags,publisher,published,page_count,isbn,description,subtitle,genres,moods,age_rating,asin,open_library_id,google_books_id,hardcover_id,goodreads_id,public_rating,public_rating_count"`
}

func (a *API) registerEditionAdmin(api huma.API) {
	huma.Register(api, writeOp(op("linkEditionTitle", http.MethodPut, "/admin/editions/{editionId}/title", "Link an edition to a title or separate it", "editions")),
		func(ctx context.Context, in *struct {
			EditionIn
			Body wire.T005EditionLink
		}) (*bodyOut[wire.T005Edition], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			out, err := a.Reading.LinkEditionTitle(ctx, a.readingActor(ctx), mustUUID(in.EditionID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Edition]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getEditionMetadata", http.MethodGet, "/admin/editions/{editionId}/metadata", "Effective edition metadata with provenance", "editions")),
		func(ctx context.Context, in *EditionIn) (*bodyOut[wire.T005MetadataReport], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			out, err := a.Reading.MetadataReport(ctx, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005MetadataReport]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("setEditionMetadata", http.MethodPut, "/admin/editions/{editionId}/metadata/{field}", "Set a protected edit or protected clear", "editions")),
		func(ctx context.Context, in *struct {
			MetadataFieldIn
			Body wire.T005MetadataWrite
		}) (*bodyOut[wire.T005MetadataReport], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			out, err := a.Reading.SetEditionMetadata(ctx, a.readingActor(ctx), mustUUID(in.EditionID), in.Field, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005MetadataReport]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("removeEditionMetadata", http.MethodDelete, "/admin/editions/{editionId}/metadata/{field}", "Remove a protected override", "editions")),
		func(ctx context.Context, in *struct {
			MetadataFieldIn
			Body wire.T005MetadataRemove
		}) (*bodyOut[wire.T005MetadataReport], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			out, err := a.Reading.RemoveEditionMetadata(ctx, a.readingActor(ctx), mustUUID(in.EditionID), in.Field, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005MetadataReport]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("searchEditionProviders", http.MethodPost, "/admin/editions/{editionId}/metadata/provider-search", "Search the library's enabled metadata providers for candidates to review", "editions")),
		func(ctx context.Context, in *struct {
			EditionIn
			Body wire.T005ProviderSearch
		}) (*bodyOut[wire.T005ProviderSearchResults], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			lib, err := a.Reading.EditionLibrary(ctx, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			rep, err := a.Reading.MetadataReport(ctx, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			q, err := providerQuery(rep, in.Body.Query)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			res, err := a.Enricher.Search(ctx, lib, metadata.Query{Title: q.Title, Authors: q.Authors, ISBN: q.ISBN}, metadata.SearchOptions{Fresh: in.Body.Fresh})
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			out := wire.T005ProviderSearchResults{EditionID: in.EditionID, Enabled: res.Enabled, Query: q, Results: providerResultsWire(res, editionProviderFields)}
			return &bodyOut[wire.T005ProviderSearchResults]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("autoFillEditionMetadata", http.MethodPost, "/admin/editions/{editionId}/metadata/auto-fill", "Fill empty fields from an unambiguous identifier match", "editions")),
		func(ctx context.Context, in *struct {
			EditionIn
			Body wire.T005AutoFill
		}) (*bodyOut[wire.T005AutoFillResult], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			id := mustUUID(in.EditionID)
			lib, err := a.Reading.EditionLibrary(ctx, id)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			rep, err := a.Reading.MetadataReport(ctx, id)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			if rep.Revision != in.Body.BaseRevision {
				return nil, a.fail(ctx, apperr.New(http.StatusConflict, "stale_revision", "The edition changed since that revision; refetch and retry.").With("currentRevision", rep.Revision))
			}
			q, err := providerQuery(rep, wire.T005ProviderQuery{})
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			res, err := a.Enricher.Search(ctx, lib, metadata.Query{Title: q.Title, Authors: q.Authors, ISBN: q.ISBN}, metadata.SearchOptions{Fresh: true})
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			language := ""
			for _, f := range rep.Fields {
				if f.Field == "language" && !f.Cleared {
					_ = json.Unmarshal(f.Value.Raw, &language)
				}
			}
			m, outcome, rule := metadata.PickAutoFill(res, metadata.Query{Title: q.Title, Authors: q.Authors, ISBN: q.ISBN}, language)
			out := wire.T005AutoFillResult{Outcome: outcome, Filled: []string{}, Revision: rep.Revision, Rule: rule}
			if outcome != "filled" {
				return &bodyOut[wire.T005AutoFillResult]{Body: out}, nil
			}
			// Only fields with no value at all are offered; the service rechecks them at commit time.
			has := map[string]bool{}
			for _, f := range rep.Fields {
				has[f.Field] = true
			}
			values := map[string]json.RawMessage{}
			for k, v := range m.Fields {
				if editionProviderFields[k] && !has[k] {
					values[k] = v
				}
			}
			if len(values) == 0 {
				out.Outcome, out.Provider = "nothing_to_fill", m.Provider
				return &bodyOut[wire.T005AutoFillResult]{Body: out}, nil
			}
			if in.Body.DryRun { // the person reviews the values and saves the ones they keep (ADR-0090); nothing is stored here
				out.Outcome, out.Provider, out.Proposed = "proposed", m.Provider, map[string]wire.T005MetadataValue{}
				for k, v := range values {
					out.Proposed[k] = wire.T005MetadataValue{Raw: v}
				}
				return &bodyOut[wire.T005AutoFillResult]{Body: out}, nil
			}
			done, err := a.Reading.AutoFillEdition(ctx, a.readingActor(ctx), id, in.Body, m.Provider, values)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			done.Rule = rule
			return &bodyOut[wire.T005AutoFillResult]{Body: done}, nil
		})
}
