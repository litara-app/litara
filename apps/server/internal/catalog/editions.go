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

func issue(code, detail string) wire.EditionIssue {
	return wire.EditionIssue{Code: code, Detail: detail}
}

func supported() wire.Capability {
	return wire.Capability{State: "supported", Issues: []wire.EditionIssue{}}
}

func incomplete(code, detail string) wire.Capability {
	return wire.Capability{State: "incomplete", Issues: []wire.EditionIssue{issue(code, detail)}}
}

func unsupported(code, detail string) wire.Capability {
	return wire.Capability{State: "unsupported", Issues: []wire.EditionIssue{issue(code, detail)}}
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
func capabilities(format string, available bool) wire.EditionCapabilities {
	var read wire.Capability
	switch format {
	case "epub", "fb2", "pdf", "cbz":
		read = supported() // generated fixtures rendered in Chromium, Firefox and WebKit
	case "kepub":
		read = incomplete("format_untested", "KEPUB uses the EPUB reader but Kobo-specific spans are not yet tested.")
	case "mobi", "azw", "azw3":
		// A Calibre-generated MOBI and AZW3 rendered text in Chromium, Firefox and WebKit (research/t005/format-matrix.md).
		// Real-world, DRM and large files were not tested.
		read = supported()
	case "cbr", "cb7":
		// ADR-0072: bounded Go extraction (rardecode/v2, sevenzip). Verified on generated stored RAR5, 7-Zip and
		// writer-made 7z archives in the browser matrix; real compressed RAR files were not tested.
		read = supported()
	}
	if !available && read.State == "supported" {
		read = incomplete("file_unavailable", "The file is currently missing or unavailable.")
	}
	download := supported()
	if !available {
		download = incomplete("file_unavailable", "The file is currently missing or unavailable.")
	}
	text := format != "cbz" && format != "cbr" && format != "cb7"
	// Resume is claimed for the formats whose saved places were browser-tested to come back as the same text after a
	// reload and a text-size change: EPUB, FB2, MOBI and AZW3 (generated fixtures, Chromium, Firefox, WebKit).
	resume := supported()
	if !available {
		resume = incomplete("file_unavailable", "The file is currently missing or unavailable.")
	}
	// The annotation API stores bookmarks and notes for any format. Text selection and highlighting
	// are claimed only where the web reader's selection was browser-tested: EPUB (Foliate range
	// CFIs) and PDF (PDF.js text layer, stored as rectangles) in Chromium, Firefox and WebKit.
	annotate := supported()
	if !available {
		annotate = incomplete("file_unavailable", "The file is currently missing or unavailable.")
	}
	c := wire.EditionCapabilities{Read: read, Download: download, Resume: resume, PageNote: annotate, Bookmark: annotate}
	if text {
		sel := incomplete("selection_untested", "Text selection in this format has not been browser-tested yet.")
		if format == "epub" || format == "pdf" {
			sel = supported()
		}
		c.TextSelection, c.TextHighlight = sel, sel
	} else {
		no := unsupported("image_pages", "Comic pages are images; there is no text to select.")
		c.TextSelection, c.TextHighlight = no, no
	}
	return c
}

func (s *Service) editionWire(r editionRow) wire.Edition {
	avail := "available"
	switch {
	case r.Missing:
		avail = "missing"
	case !r.Available:
		avail = "unavailable"
	}
	file := wire.EditionFile{ID: r.FileID.String(), ContentVersion: r.ContentVersion.String(), Format: r.Format,
		MimeType: r.MimeType, SizeBytes: r.SizeBytes, Availability: avail}
	if avail == "available" {
		p := fmt.Sprintf("%s/files/%s/versions/%s/content", s.apiBase, r.FileID, r.ContentVersion)
		file.ContentPath = &p
	}
	caps := capabilities(r.Format, avail == "available")
	if r.FileDamaged && avail == "available" {
		damage := incomplete("file_damaged", "The ebook file is damaged. Replace it with a readable copy and rescan the library.")
		caps.Read, caps.Resume, caps.TextSelection, caps.TextHighlight = damage, damage, damage, damage
	}
	readiness := map[string]string{"supported": "ready", "incomplete": "incomplete", "unsupported": "unsupported"}[caps.Read.State]
	return wire.Edition{ID: r.ID.String(), TitleID: r.TitleID.String(), LibraryID: r.LibraryID.String(),
		Revision: strconv.FormatInt(r.Revision, 10), Label: r.Label, Language: r.Language, File: file,
		Readiness: readiness, Issues: append([]wire.EditionIssue{}, caps.Read.Issues...),
		// Completion storage arrives with the reading-state slice; revision 0 means never written.
		Completion:   wire.ReadingCompletion{Revision: "0", Finished: false},
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

func (s *Service) Edition(ctx context.Context, userID, id uuid.UUID) (wire.Edition, error) {
	r, err := s.authorizeEdition(ctx, userID, id)
	if err != nil {
		return wire.Edition{}, err
	}
	out := s.editionWire(r)
	if out.Completion, err = s.CompletionState(ctx, userID, id); err != nil {
		return wire.Edition{}, err
	}
	return out, nil
}

func (s *Service) Reader(ctx context.Context, userID, id uuid.UUID) (wire.ReaderSnapshot, error) {
	r, err := s.authorizeEdition(ctx, userID, id)
	if err != nil {
		return wire.ReaderSnapshot{}, err
	}
	engine, profile := engineFor(r.Format)
	ed := s.editionWire(r)
	if ed.Completion, err = s.CompletionState(ctx, userID, id); err != nil {
		return wire.ReaderSnapshot{}, err
	}
	pos, err := s.PositionState(ctx, userID, id)
	if err != nil {
		return wire.ReaderSnapshot{}, err
	}
	return wire.ReaderSnapshot{SchemaVersion: 1, Edition: ed, Position: pos, Engine: engine, EngineProfile: profile}, nil
}

type EditionListParams struct {
	LibraryID, TitleID *uuid.UUID
	Page, Size         int
}

func (s *Service) Editions(ctx context.Context, userID uuid.UUID, p EditionListParams) (wire.Editions, error) {
	rows, err := s.q.ListEditionsPage(ctx, sqlcgen.ListEditionsPageParams{UserID: userID, LibraryID: nullUUID(p.LibraryID),
		TitleID: nullUUID(p.TitleID), PageSize: int32(p.Size), PageOffset: int32(p.Page * p.Size)})
	if err != nil {
		return wire.Editions{}, unavailable(err)
	}
	total, err := s.q.CountEditionsPage(ctx, sqlcgen.CountEditionsPageParams{UserID: userID, LibraryID: nullUUID(p.LibraryID), TitleID: nullUUID(p.TitleID)})
	if err != nil {
		return wire.Editions{}, unavailable(err)
	}
	out := wire.Editions{Items: []wire.Edition{}, Total: total, Page: int64(p.Page), Size: int64(p.Size)}
	for _, r := range rows {
		ed := s.editionWire(editionRow(r))
		if ed.Completion, err = s.CompletionState(ctx, userID, r.ID); err != nil {
			return wire.Editions{}, err
		}
		out.Items = append(out.Items, ed)
	}
	return out, nil
}

func nullUUID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}

// AuthorizeEdition is the shared edition access check: unknown 404, ungranted
// 403. Personal-state services call it before they open a transaction.
func (s *Service) AuthorizeEdition(ctx context.Context, userID, id uuid.UUID) (sqlcgen.GetEditionRowRow, error) {
	return s.authorizeEdition(ctx, userID, id)
}

// TitleVisible reports whether the user may see a title (404 unknown, 403 none granted).
func (s *Service) TitleVisible(ctx context.Context, userID, id uuid.UUID) error {
	_, err := s.Title(ctx, userID, id)
	return err
}

// EditionTx renders an edition through q so a writer sees its own uncommitted
// change. The caller has already authorized the edition for userID.
func (s *Service) EditionTx(ctx context.Context, q *sqlcgen.Queries, userID, id uuid.UUID) (wire.Edition, error) {
	r, err := q.GetEditionRow(ctx, id)
	if err != nil {
		return wire.Edition{}, unavailable(err)
	}
	out := s.editionWire(r)
	out.Completion, err = s.CompletionStateTx(ctx, q, userID, id)
	return out, err
}

// Base is the API base path (for building self links).
func (s *Service) Base() string { return s.apiBase }

// ComicFormat resolves a file the caller may read to its comic edition format.
// Authorization (404/403/412 order) is ResolveFile's; a file that is not a
// comic container is refused with 422.
func (s *Service) ComicFormat(ctx context.Context, userID, fileID, version uuid.UUID) (FileTarget, string, error) {
	t, err := s.ResolveFile(ctx, userID, fileID, version)
	if err != nil {
		return t, "", err
	}
	format, err := s.q.FirstGrantedEditionFormat(ctx, sqlcgen.FirstGrantedEditionFormatParams{FileID: fileID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && format != "cbz" && format != "cbr" && format != "cb7") {
		return t, "", apperr.Validation("This file is not a comic archive.")
	}
	if err != nil {
		return t, "", unavailable(err)
	}
	return t, format, nil
}
