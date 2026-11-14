package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

// Enricher fills metadata gaps from the providers a library has enabled
// (ADR-0049/0060). Only an unambiguous identifier match with consistent
// metadata is applied automatically; every other result goes to review.
type Enricher struct {
	*Service
	Providers map[string]Provider
}

func norm(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// consistent reports whether a provider match agrees with what we already know:
// the same normalized title and, when both sides list authors, an overlap.
func consistent(m Match, title string, authors []string) bool {
	var mt string
	if json.Unmarshal(m.Fields[FieldTitle], &mt) != nil || norm(mt) == "" || norm(mt) != norm(title) {
		return false
	}
	var ma []string
	_ = json.Unmarshal(m.Fields[FieldAuthors], &ma)
	if len(ma) == 0 || len(authors) == 0 {
		return true
	}
	have := map[string]bool{}
	for _, a := range authors {
		have[norm(a)] = true
	}
	for _, a := range ma {
		if have[norm(a)] {
			return true
		}
	}
	return false
}

// EnrichLibrary runs enabled providers for recordings that have not been looked up.
func (e *Enricher) EnrichLibrary(ctx context.Context, lib uuid.UUID) error {
	q := sqlcgen.New(e.Pool)
	cfg, err := q.GetLibraryConfig(ctx, lib)
	if err != nil {
		return err
	}
	if len(cfg.ProviderOrder) == 0 {
		return nil // lookups stay disabled until the library enables a provider
	}
	recs, err := q.ListLibraryRecordings(ctx, lib)
	if err != nil {
		return err
	}
	for _, r := range recs {
		for _, name := range cfg.ProviderOrder {
			p, ok := e.Providers[name]
			if !ok {
				continue
			}
			if prev, err := q.GetProviderLookup(ctx, sqlcgen.GetProviderLookupParams{RecordingID: r.ID, Provider: name}); err == nil && prev.Outcome != "error" {
				continue
			} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			done, err := e.enrichOne(ctx, lib, r.ID, r.TitleID, p)
			if err != nil {
				return err
			}
			if done {
				break // an applied provider ends the chain for this recording
			}
		}
	}
	return nil
}

func (e *Enricher) enrichOne(ctx context.Context, lib, recID, titleID uuid.UUID, p Provider) (applied bool, err error) {
	q := sqlcgen.New(e.Pool)
	title, err := q.GetTitleRow(ctx, titleID)
	if err != nil {
		return false, err
	}
	qry := Query{Title: title.Title, Authors: title.Authors}
	if title.Identifier != nil {
		qry.ISBN, qry.ASIN = SplitIdentifier(*title.Identifier)
	}
	record := func(outcome, detail string) error {
		var d *string
		if detail != "" {
			d = &detail
		}
		return q.SetProviderLookup(ctx, sqlcgen.SetProviderLookupParams{RecordingID: recID, Provider: p.Name(), Outcome: outcome, Detail: d})
	}
	matches, lerr := p.Lookup(ctx, qry)
	if lerr != nil {
		return false, record("error", lerr.Error())
	}
	if len(matches) == 0 {
		return false, record("no_match", "")
	}
	if len(matches) == 1 && matches[0].ByIdentifier && consistent(matches[0], title.Title, title.Authors) {
		if err := e.ApplyMatch(ctx, recID, matches[0]); err != nil {
			return false, err
		}
		return true, record("applied", matches[0].ID)
	}
	// Uncertain, conflicting or search-only: a person decides; never the first hit.
	if len(matches) > 5 {
		matches = matches[:5]
	}
	raw, _ := json.Marshal(map[string]any{"recording": recID.String(), "provider": p.Name(), "matches": matches})
	if _, err := q.UpsertOpenReview(ctx, sqlcgen.UpsertOpenReviewParams{LibraryID: lib, Kind: "provider",
		SubjectKey: fmt.Sprintf("%s:%s", recID, p.Name()), Candidates: raw}); err != nil {
		return false, err
	}
	return false, record("needs_review", fmt.Sprintf("%d candidate(s)", len(matches)))
}

// ApplyMatch stores provider values only for fields no other source provides.
func (e *Enricher) ApplyMatch(ctx context.Context, recID uuid.UUID, m Match) error {
	existing, err := e.Report(ctx, recID)
	if err != nil {
		return err
	}
	q := sqlcgen.New(e.Pool)
	rec, err := q.GetRecordingRow(ctx, recID)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return err
	}
	fields := make([]string, 0, len(m.Fields))
	for f := range m.Fields {
		fields = append(fields, f)
	}
	sort.Strings(fields)
	for _, f := range fields {
		if !Valid(f) {
			continue
		}
		if cur, has := existing[f]; has && cur.Source != SourceProvider {
			continue // gap-filling only: never override user, sidecar or embedded
		}
		if err := q.UpsertMetadataValue(ctx, sqlcgen.UpsertMetadataValueParams{SubjectKind: SubjectKind(f), SubjectID: subject(rec, f),
			Field: f, Source: SourceProvider, Value: m.Fields[f]}); err != nil {
			return err
		}
	}
	return e.Apply(ctx, recID)
}

// ResolveProvider applies (or rejects) one candidate of a provider review.
func (e *Enricher) ResolveProvider(ctx context.Context, candidates []byte, action string, index *int) error {
	var c struct {
		Recording string  `json:"recording"`
		Matches   []Match `json:"matches"`
	}
	if json.Unmarshal(candidates, &c) != nil {
		return apperr.ErrUnavailable
	}
	switch action {
	case "reject":
		return nil
	case "apply":
		rec, err := uuid.Parse(c.Recording)
		if err != nil || index == nil || *index < 0 || *index >= len(c.Matches) {
			return apperr.Validation("index must select one of the offered candidates")
		}
		return e.ApplyMatch(ctx, rec, c.Matches[*index])
	}
	return apperr.Validation("action must be apply or reject")
}
