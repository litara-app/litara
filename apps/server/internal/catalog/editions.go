package catalog

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Pinned engine profiles (ADR-0027, ADR-0071): Foliate 78914aef and PDF.js
// 6.5.438 as vendored for the web app. A changed engine must change the
// string; locators are never reinterpreted across profiles.
const (
	ProfileFoliate = "foliate-js@78914aef/profile-1"
	ProfilePDFJS   = "pdfjs-dist@6.5.438/profile-1"
)

type editionRow = sqlcgen.GetEditionRowRow

func issue(code, detail string) wire.T005Issue { return wire.T005Issue{Code: code, Detail: detail} }

func supported() wire.T005Capability {
	return wire.T005Capability{State: "supported", Issues: []wire.T005Issue{}}
}

func incomplete(code, detail string) wire.T005Capability {
	return wire.T005Capability{State: "incomplete", Issues: []wire.T005Issue{issue(code, detail)}}
}

func unsupported(code, detail string) wire.T005Capability {
	return wire.T005Capability{State: "unsupported", Issues: []wire.T005Issue{issue(code, detail)}}
}

// engineFor maps a format to its web engine and profile.
func engineFor(format string) (engine, profile string) {
	switch format {
	case "pdf":
		return "pdfjs", ProfilePDFJS
	case "cbr", "cb7":
		return "image-pages", "image-pages@profile-1"
	default:
		return "foliate", ProfileFoliate
	}
}

// capabilities states only what is implemented and browser-tested. Recognized
// is not supported (ADR-0025): untested or pending behavior is "incomplete".
func capabilities(format string, available bool) wire.T005Capabilities {
	var read wire.T005Capability
	switch format {
	case "epub", "fb2", "pdf", "cbz":
		read = supported() // generated fixtures rendered in Chromium, Firefox and WebKit
	case "kepub":
		read = incomplete("format_untested", "KEPUB uses the EPUB reader but Kobo-specific spans are not yet tested.")
	case "mobi", "azw", "azw3":
		read = incomplete("format_untested", "Foliate recognizes this format but no fixture has been verified in a browser.")
	case "cbr", "cb7":
		read = incomplete("page_extraction_pending", "Server-side page extraction for this archive type is not implemented yet.")
	}
	if !available && read.State == "supported" {
		read = incomplete("file_unavailable", "The file is currently missing or unavailable.")
	}
	download := supported()
	if !available {
		download = incomplete("file_unavailable", "The file is currently missing or unavailable.")
	}
	pending := func() wire.T005Capability {
		return incomplete("not_implemented", "The server API for this capability is not implemented yet.")
	}
	text := format != "cbz" && format != "cbr" && format != "cb7"
	c := wire.T005Capabilities{Read: read, Download: download, Resume: pending(), PageNote: pending(), Bookmark: pending()}
	if text {
		c.TextSelection, c.TextHighlight = pending(), pending()
	} else {
		no := unsupported("image_pages", "Comic pages are images; there is no text to select.")
		c.TextSelection, c.TextHighlight = no, no
	}
	return c
}

func (s *Service) editionWire(r editionRow) wire.T005Edition {
	avail := "available"
	switch {
	case r.Missing:
		avail = "missing"
	case !r.Available:
		avail = "unavailable"
	}
	file := wire.T005File{ID: r.FileID.String(), ContentVersion: r.ContentVersion.String(), Format: r.Format,
		MimeType: r.MimeType, SizeBytes: r.SizeBytes, Availability: avail}
	if avail == "available" {
		p := fmt.Sprintf("%s/files/%s/versions/%s/content", s.apiBase, r.FileID, r.ContentVersion)
		file.ContentPath = &p
	}
	caps := capabilities(r.Format, avail == "available")
	readiness := map[string]string{"supported": "ready", "incomplete": "incomplete", "unsupported": "unsupported"}[caps.Read.State]
	return wire.T005Edition{ID: r.ID.String(), TitleID: r.TitleID.String(), LibraryID: r.LibraryID.String(),
		Revision: strconv.FormatInt(r.Revision, 10), Label: r.Label, Language: r.Language, File: file,
		Readiness: readiness, Issues: append([]wire.T005Issue{}, caps.Read.Issues...),
		// Completion storage arrives with the reading-state slice; revision 0 means never written.
		Completion:   wire.T005Completion{Revision: "0", Finished: false},
		Capabilities: caps}
}

// authorizeEdition: unknown 404; no grant on the edition library 403.
func (s *Service) authorizeEdition(ctx context.Context, userID, id uuid.UUID) (editionRow, error) {
	r, err := s.q.GetEditionRow(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, apperr.ErrNotFound
	}
	if err != nil {
		return r, unavailable(err)
	}
	ok, err := s.q.UserHasLibraryGrant(ctx, sqlcgen.UserHasLibraryGrantParams{UserID: userID, LibraryID: r.LibraryID})
	if err != nil {
		return r, unavailable(err)
	}
	if !ok {
		return r, apperr.ErrAccessDenied
	}
	return r, nil
}

func (s *Service) Edition(ctx context.Context, userID, id uuid.UUID) (wire.T005Edition, error) {
	r, err := s.authorizeEdition(ctx, userID, id)
	if err != nil {
		return wire.T005Edition{}, err
	}
	return s.editionWire(r), nil
}

func (s *Service) Reader(ctx context.Context, userID, id uuid.UUID) (wire.T005Reader, error) {
	r, err := s.authorizeEdition(ctx, userID, id)
	if err != nil {
		return wire.T005Reader{}, err
	}
	engine, profile := engineFor(r.Format)
	return wire.T005Reader{SchemaVersion: 1, Edition: s.editionWire(r),
		Position: wire.T005PositionState{Revision: "0", ConflictsPath: fmt.Sprintf("%s/personal-conflicts", s.apiBase)},
		Engine:   engine, EngineProfile: profile}, nil
}

type EditionListParams struct {
	LibraryID, TitleID *uuid.UUID
	Page, Size         int
}

func (s *Service) Editions(ctx context.Context, userID uuid.UUID, p EditionListParams) (wire.T005Editions, error) {
	rows, err := s.q.ListEditionsPage(ctx, sqlcgen.ListEditionsPageParams{UserID: userID, LibraryID: nullUUID(p.LibraryID),
		TitleID: nullUUID(p.TitleID), PageSize: int32(p.Size), PageOffset: int32(p.Page * p.Size)})
	if err != nil {
		return wire.T005Editions{}, unavailable(err)
	}
	total, err := s.q.CountEditionsPage(ctx, sqlcgen.CountEditionsPageParams{UserID: userID, LibraryID: nullUUID(p.LibraryID), TitleID: nullUUID(p.TitleID)})
	if err != nil {
		return wire.T005Editions{}, unavailable(err)
	}
	out := wire.T005Editions{Items: []wire.T005Edition{}, Total: total, Page: int64(p.Page), Size: int64(p.Size)}
	for _, r := range rows {
		out.Items = append(out.Items, s.editionWire(editionRow(r)))
	}
	return out, nil
}

func nullUUID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}
