package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/paperimport"
	"github.com/deranjer/ebooker/apps/server/internal/reading"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type ImportIn struct {
	ImportID string `path:"importId" format:"uuid"`
}

// ownImport requires the caller's own import, and that they still manage its library.
func (a *API) ownImport(ctx context.Context, id string) (sqlcgen.PaperImport, error) {
	imp, err := a.Reading.PaperImportRecord(ctx, principal(ctx).UserID, mustUUID(id))
	if err != nil {
		return imp, a.fail(ctx, err)
	}
	return imp, a.manage(ctx, imp.LibraryID)
}

// download declares a CSV response and sends one.
func csvDownload(o huma.Operation, description string) huma.Operation {
	o.Responses["200"] = &huma.Response{Description: description, Headers: map[string]*huma.Param{"Content-Disposition": {Schema: &huma.Schema{Type: "string"}}},
		Content: map[string]*huma.MediaType{"text/csv": {Schema: &huma.Schema{Type: "string"}}}}
	return o
}

func sendCSV(name string, body []byte) *huma.StreamResponse {
	return &huma.StreamResponse{Body: func(hc huma.Context) {
		hc.SetHeader("Content-Type", "text/csv; charset=utf-8")
		hc.SetHeader("Content-Disposition", contentDisposition(name))
		hc.SetHeader("Cache-Control", "private, no-store")
		hc.SetHeader("Content-Length", strconv.Itoa(len(body)))
		hc.SetStatus(http.StatusOK)
		_, _ = hc.BodyWriter().Write(body)
	}}
}

// registerPaperImports mounts the CSV import of paper books (ADR-0117). Every operation needs an administrator with
// access to the library, and an import is only ever the uploader's.
func (a *API) registerPaperImports(api huma.API) {
	const tag = "physical-books"

	upload := adminOp(writeOp(op("createPaperImport", http.MethodPost, "/admin/paper-imports",
		"Upload a CSV list of paper books to review. Nothing in the catalogue changes.", tag)))
	upload.Security = secured
	upload.MaxBodyBytes = paperimport.MaxBytes
	upload.RequestBody = &huma.RequestBody{Required: true, Content: map[string]*huma.MediaType{
		"text/csv": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}}
	huma.Register(api, upload, func(ctx context.Context, in *struct {
		LibraryID string `query:"libraryId" format:"uuid" required:"true"`
		RawBody   []byte
	}) (*bodyOut[wire.PaperImport], error) {
		lib, err := uuid.Parse(in.LibraryID)
		if err != nil {
			return nil, a.fail(ctx, apperr.Validation("libraryId must be a UUID."))
		}
		if err := a.manage(ctx, lib); err != nil {
			return nil, err
		}
		out, err := a.Reading.CreatePaperImport(ctx, principal(ctx).UserID, lib, in.RawBody)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.PaperImport]{Body: out}, nil
	})

	huma.Register(api, adminOp(readOp(op("listPaperImports", http.MethodGet, "/admin/paper-imports", "Your own CSV imports", tag))),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.PaperImports], error) {
			out, err := a.Reading.PaperImports(ctx, principal(ctx).UserID)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperImports]{Body: out}, nil
		})

	huma.Register(api, csvDownload(adminOp(readOp(op("getPaperImportTemplate", http.MethodGet, "/admin/paper-imports/template",
		"An empty CSV file with the columns an import reads", tag))), "The template, as an attachment"),
		func(_ context.Context, _ *struct{}) (*huma.StreamResponse, error) {
			return sendCSV("litara-paper-books.csv", reading.PaperImportTemplate()), nil
		})

	huma.Register(api, adminOp(readOp(op("getPaperImport", http.MethodGet, "/admin/paper-imports/{importId}", "An import and what applying it would do, or has done", tag))),
		func(ctx context.Context, in *ImportIn) (*bodyOut[wire.PaperImport], error) {
			if _, err := a.ownImport(ctx, in.ImportID); err != nil {
				return nil, err
			}
			out, err := a.Reading.PaperImport(ctx, principal(ctx).UserID, mustUUID(in.ImportID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperImport]{Body: out}, nil
		})

	huma.Register(api, adminOp(readOp(op("listPaperImportRows", http.MethodGet, "/admin/paper-imports/{importId}/rows", "The rows of an import", tag))),
		func(ctx context.Context, in *struct {
			ImportIn
			PageQuery
			Show string `query:"show" enum:"all,choose,copies,reading,left,problems" default:"all"`
		}) (*bodyOut[wire.PaperImportRows], error) {
			if _, err := a.ownImport(ctx, in.ImportID); err != nil {
				return nil, err
			}
			page, size := in.normalized()
			out, err := a.Reading.PaperImportRows(ctx, principal(ctx).UserID, mustUUID(in.ImportID), in.Show, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperImportRows]{Body: out}, nil
		})

	huma.Register(api, adminOp(writeOp(op("setPaperImportOptions", http.MethodPut, "/admin/paper-imports/{importId}/options",
		"Answer which books are owned on paper, and whether to import your own reading", tag))),
		func(ctx context.Context, in *struct {
			ImportIn
			Body wire.PaperImportOptions
		}) (*bodyOut[wire.PaperImport], error) {
			if _, err := a.ownImport(ctx, in.ImportID); err != nil {
				return nil, err
			}
			out, err := a.Reading.SetPaperImportOptions(ctx, principal(ctx).UserID, mustUUID(in.ImportID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperImport]{Body: out}, nil
		})

	huma.Register(api, adminOp(writeOp(op("setPaperImportRow", http.MethodPut, "/admin/paper-imports/{importId}/rows/{row}", "Choose what one row does", tag))),
		func(ctx context.Context, in *struct {
			ImportIn
			Row  int `path:"row" minimum:"2" maximum:"100000"`
			Body wire.PaperImportRowChange
		}) (*bodyOut[wire.PaperImportRow], error) {
			if _, err := a.ownImport(ctx, in.ImportID); err != nil {
				return nil, err
			}
			out, err := a.Reading.SetPaperImportRow(ctx, principal(ctx).UserID, mustUUID(in.ImportID), in.Row, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperImportRow]{Body: out}, nil
		})

	huma.Register(api, adminOp(writeOp(op("applyPaperImport", http.MethodPost, "/admin/paper-imports/{importId}/apply",
		"Apply the import as reviewed; applying again changes nothing", tag))),
		func(ctx context.Context, in *struct {
			ImportIn
			Body wire.ApplyPaperImport
		}) (*bodyOut[wire.PaperImport], error) {
			if _, err := a.ownImport(ctx, in.ImportID); err != nil {
				return nil, err
			}
			base, err := strconv.ParseInt(in.Body.BaseRevision, 10, 64)
			if err != nil {
				return nil, a.fail(ctx, apperr.Validation("baseRevision must be a nonnegative decimal string."))
			}
			id := mustUUID(in.ImportID)
			out, err := a.Reading.ApplyPaperImport(ctx, principal(ctx).UserID, id, base,
				func(tx pgx.Tx) error { return a.Jobs.EnqueuePaperImport(ctx, tx, id) })
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PaperImport]{Body: out}, nil
		})

	del := adminOp(writeOp(op("deletePaperImport", http.MethodDelete, "/admin/paper-imports/{importId}",
		"Cancel a review, or remove a finished report. What was applied stays.", tag)))
	del.Security, del.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, del, func(ctx context.Context, in *ImportIn) (*noContent, error) {
		if _, err := a.ownImport(ctx, in.ImportID); err != nil {
			return nil, err
		}
		return nil, a.fail2(ctx, a.Reading.DeletePaperImport(ctx, principal(ctx).UserID, mustUUID(in.ImportID)))
	})

	huma.Register(api, csvDownload(adminOp(readOp(op("getPaperImportReport", http.MethodGet, "/admin/paper-imports/{importId}/report",
		"What an applied import did, as CSV", tag))), "The report, as an attachment"),
		func(ctx context.Context, in *ImportIn) (*huma.StreamResponse, error) {
			if _, err := a.ownImport(ctx, in.ImportID); err != nil {
				return nil, err
			}
			body, err := a.Reading.PaperImportReport(ctx, principal(ctx).UserID, mustUUID(in.ImportID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return sendCSV("litara-import-report.csv", body), nil
		})
}
