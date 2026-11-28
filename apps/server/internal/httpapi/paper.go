package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/reading"
	"github.com/deranjer/ebooker/apps/server/internal/receipts"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type CopyIn struct {
	CopyID string `path:"copyId" format:"uuid"`
}

// manageTitle requires an administrator with access to a library that holds a copy of a paper-only title.
func (a *API) manageTitle(ctx context.Context, titleID uuid.UUID) error {
	libs, err := a.Reading.PaperOnlyTitle(ctx, titleID)
	if err != nil {
		return a.fail(ctx, err)
	}
	p := principal(ctx)
	var denied error = apperr.ErrAccessDenied
	for _, lib := range libs {
		if denied = a.Library.Authorize(ctx, p.UserID, p.IsAdmin, lib); denied == nil {
			return nil
		}
	}
	return a.fail(ctx, denied)
}

// registerPaper mounts physical copies and paper reading (ADR-0116). Seeing a copy and tracking one's own reading
// need access to its library; adding, changing and removing copies need an administrator with that access.
func (a *API) registerPaper(api huma.API) {
	huma.Register(api, readOp(op("listTitleCopies", http.MethodGet, "/titles/{titleId}/physical-copies", "Paper copies of a title in your libraries", "physical-books")),
		func(ctx context.Context, in *struct {
			TitleIn
			PageQuery
		}) (*bodyOut[wire.PhysicalCopies], error) {
			page, size := in.normalized()
			out, err := a.Reading.TitleCopies(ctx, principal(ctx).UserID, mustUUID(in.TitleID), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PhysicalCopies]{Body: out}, nil
		})

	huma.Register(api, readOp(op("listPaperHistory", http.MethodGet, "/titles/{titleId}/paper-history", "Your own paper reading history for a title", "physical-books")),
		func(ctx context.Context, in *struct {
			TitleIn
			PageQuery
		}) (*bodyOut[wire.PaperHistory], error) {
			page, size := in.normalized()
			out, err := a.Reading.PaperHistory(ctx, principal(ctx).UserID, mustUUID(in.TitleID), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperHistory]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getPaperReading", http.MethodGet, "/physical-copies/{copyId}/reading", "Your own reading of a paper copy", "physical-books")),
		func(ctx context.Context, in *CopyIn) (*bodyOut[wire.PaperReading], error) {
			out, err := a.Reading.PaperReading(ctx, principal(ctx).UserID, mustUUID(in.CopyID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperReading]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("setPaperReading", http.MethodPut, "/physical-copies/{copyId}/reading", "Set your reading status and page for a paper copy", "physical-books")),
		func(ctx context.Context, in *struct {
			CopyIn
			Body wire.PaperReadingWrite
		}) (*bodyOut[wire.PaperReading], error) {
			out, err := a.Reading.WritePaperReading(ctx, a.readingActor(ctx), mustUUID(in.CopyID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperReading]{Body: out}, nil
		})

	huma.Register(api, adminOp(readOp(op("listCopyLocations", http.MethodGet, "/admin/physical-copy-locations", "Locations already used for paper copies", "physical-books"))),
		func(ctx context.Context, in *struct {
			LibraryID string `query:"libraryId" format:"uuid"`
		}) (*bodyOut[wire.CopyLocations], error) {
			out, err := a.Reading.CopyLocations(ctx, principal(ctx).UserID, uuidPtr(in.LibraryID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.CopyLocations]{Body: out}, nil
		})

	huma.Register(api, adminOp(writeOp(op("lookUpPaperBook", http.MethodPost, "/admin/libraries/{libraryId}/physical-lookup",
		"Look a paper book up with the library's metadata providers and in your catalogue", "physical-books"))),
		func(ctx context.Context, in *struct {
			LibraryID string `path:"libraryId" format:"uuid"`
			Body      wire.PaperLookup
		}) (*bodyOut[wire.PaperLookupResults], error) {
			lib := mustUUID(in.LibraryID)
			if err := a.manage(ctx, lib); err != nil {
				return nil, err
			}
			q := metadata.Query{Title: strings.TrimSpace(in.Body.Title)}
			for _, v := range in.Body.Authors {
				if s := strings.TrimSpace(string(v)); s != "" {
					q.Authors = append(q.Authors, s)
				}
			}
			if raw := strings.TrimSpace(in.Body.ISBN); raw != "" {
				if q.ISBN, _ = metadata.SplitIdentifier(raw); q.ISBN == "" {
					return nil, a.fail(ctx, apperr.Validation("isbn must be an ISBN-10 or ISBN-13."))
				}
			}
			if q.ISBN == "" && q.Title == "" {
				return nil, a.fail(ctx, apperr.Validation("Send an ISBN or a title."))
			}
			res, err := a.Enricher.Search(ctx, lib, q, metadata.SearchOptions{Fresh: in.Body.Fresh})
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			// What the catalogue is compared with: the person's own words, else what a provider found for the ISBN.
			name, authors := q.Title, q.Authors
			if name == "" {
				for _, r := range res.Results {
					for _, c := range r.Candidates {
						if name == "" && c.ByIdentifier {
							_ = json.Unmarshal(c.Fields["title"], &name)
							_ = json.Unmarshal(c.Fields["authors"], &authors)
						}
					}
				}
			}
			matches, err := a.Reading.PaperMatches(ctx, principal(ctx).UserID, name, authors, q.ISBN)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperLookupResults]{Body: wire.PaperLookupResults{Enabled: res.Enabled,
				Results: providerResultsWire(res, editionProviderFields), Matches: matches}}, nil
		})

	manageLibrary := func(ctx context.Context, id string) error {
		lib, err := uuid.Parse(id)
		if err != nil {
			return a.fail(ctx, apperr.Validation("libraryId must be a UUID."))
		}
		return a.manage(ctx, lib)
	}

	huma.Register(api, adminOp(writeOp(op("addPhysicalCopy", http.MethodPost, "/admin/physical-copies", "Add a paper copy, of a book in the catalogue or a new one", "physical-books"))),
		func(ctx context.Context, in *struct{ Body wire.AddPhysicalCopy }) (*bodyOut[wire.PhysicalCopy], error) {
			if err := manageLibrary(ctx, in.Body.LibraryID); err != nil {
				return nil, err
			}
			out, err := a.Reading.AddCopy(ctx, principal(ctx).UserID, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PhysicalCopy]{Body: out}, nil
		})

	huma.Register(api, adminOp(writeOp(op("updatePhysicalCopy", http.MethodPut, "/admin/physical-copies/{copyId}", "Change a paper copy, or move it to another book or library", "physical-books"))),
		func(ctx context.Context, in *struct {
			CopyIn
			Body wire.UpdatePhysicalCopy
		}) (*bodyOut[wire.PhysicalCopy], error) {
			id := mustUUID(in.CopyID)
			cur, err := a.Reading.CopyRow(ctx, id)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			if err := a.manage(ctx, cur.LibraryID); err != nil {
				return nil, err
			}
			if err := manageLibrary(ctx, in.Body.LibraryID); err != nil {
				return nil, err
			}
			out, err := a.Reading.UpdateCopy(ctx, principal(ctx).UserID, id, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PhysicalCopy]{Body: out}, nil
		})

	huma.Register(api, adminOp(writeOp(op("removePhysicalCopy", http.MethodPost, "/admin/physical-copies/{copyId}/remove", "Remove a paper copy; readers keep their history", "physical-books"))),
		func(ctx context.Context, in *struct {
			CopyIn
			Body wire.RemovePhysicalCopy
		}) (*bodyOut[wire.PhysicalCopy], error) {
			id := mustUUID(in.CopyID)
			cur, err := a.Reading.CopyRow(ctx, id)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			if err := a.manage(ctx, cur.LibraryID); err != nil {
				return nil, err
			}
			out, err := a.Reading.RemoveCopy(ctx, principal(ctx).UserID, id, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PhysicalCopy]{Body: out}, nil
		})

	huma.Register(api, adminOp(readOp(op("getPaperTitleMetadata", http.MethodGet, "/admin/titles/{titleId}/metadata",
		"The details of a book that has only paper copies", "physical-books"))),
		func(ctx context.Context, in *TitleIn) (*bodyOut[wire.MetadataReport], error) {
			id := mustUUID(in.TitleID)
			if err := a.manageTitle(ctx, id); err != nil {
				return nil, err
			}
			rep, rev, err := a.Metadata.TitleReport(ctx, id)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.MetadataReport]{Body: recordingReport(rep, rev)}, nil
		})

	huma.Register(api, adminOp(writeOp(op("savePaperTitleMetadata", http.MethodPatch, "/admin/titles/{titleId}/metadata",
		"Save the details of a book that has only paper copies", "physical-books"))),
		func(ctx context.Context, in *struct {
			TitleIn
			Body wire.MetadataSave
		}) (*bodyOut[wire.MetadataReport], error) {
			id := mustUUID(in.TitleID)
			if err := a.manageTitle(ctx, id); err != nil {
				return nil, err
			}
			opID, err := uuid.Parse(in.Body.OperationID)
			if err != nil {
				return nil, a.fail(ctx, apperr.Validation("operationId must be a UUID"))
			}
			base, err := strconv.ParseInt(in.Body.BaseRevision, 10, 64)
			if err != nil {
				return nil, a.fail(ctx, apperr.Validation("baseRevision must be a nonnegative decimal string"))
			}
			fp := receipts.Fingerprint(http.MethodPatch, "/admin/titles/"+id.String()+"/metadata", in.Body)
			body, err := a.Metadata.SaveTitle(ctx, principal(ctx).UserID, id, opID, base, reading.MetadataChanges(in.Body.Changes), fp,
				func(rep map[string]metadata.Effective, rev int64) []byte { return wire.Raw(recordingReport(rep, rev)) })
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			var out wire.MetadataReport
			if err := json.Unmarshal(body, &out); err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.MetadataReport]{Body: out}, nil
		})
}
