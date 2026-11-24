package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
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
	// CacheTTL keeps successful provider searches in memory for that long (ADR-0087). Zero turns the cache off.
	CacheTTL time.Duration
	// Now is the clock for the cache (tests only; nil means time.Now).
	Now func() time.Time

	cacheMu sync.Mutex
	cache   map[string]cachedSearch
}

type cachedSearch struct {
	matches []Match
	expires time.Time
}

const maxCachedSearches = 256

func (e *Enricher) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

func searchKey(provider string, q Query) string {
	return strings.Join([]string{provider, norm(q.Title), norm(strings.Join(q.Authors, ",")), strings.ToUpper(q.ISBN), strings.ToUpper(q.ASIN)}, "\x00")
}

func (e *Enricher) cached(key string) ([]Match, bool) {
	if e.CacheTTL <= 0 {
		return nil, false
	}
	e.cacheMu.Lock()
	defer e.cacheMu.Unlock()
	c, ok := e.cache[key]
	if !ok || !e.now().Before(c.expires) {
		delete(e.cache, key)
		return nil, false
	}
	return c.matches, true
}

// remember stores a successful lookup. Failures are never stored, so an outage or rate limit is retried at once.
func (e *Enricher) remember(key string, matches []Match) {
	if e.CacheTTL <= 0 {
		return
	}
	e.cacheMu.Lock()
	defer e.cacheMu.Unlock()
	if e.cache == nil {
		e.cache = map[string]cachedSearch{}
	}
	now := e.now()
	if len(e.cache) >= maxCachedSearches {
		for k, c := range e.cache {
			if !now.Before(c.expires) {
				delete(e.cache, k)
			}
		}
		for k := range e.cache { // still full: make room by dropping one entry
			if len(e.cache) < maxCachedSearches {
				break
			}
			delete(e.cache, k)
		}
	}
	e.cache[key] = cachedSearch{matches: matches, expires: now.Add(e.CacheTTL)}
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
		if _, err := e.ApplyMatch(ctx, recID, matches[0]); err != nil {
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
func (e *Enricher) ApplyMatch(ctx context.Context, recID uuid.UUID, m Match) ([]string, error) {
	existing, err := e.Report(ctx, recID)
	if err != nil {
		return nil, err
	}
	q := sqlcgen.New(e.Pool)
	rec, err := q.GetRecordingRow(ctx, recID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	fields := make([]string, 0, len(m.Fields))
	for f := range m.Fields {
		fields = append(fields, f)
	}
	sort.Strings(fields)
	var applied []string
	for _, f := range fields {
		if !Valid(f) {
			continue
		}
		if cur, has := existing[f]; has && cur.Source != SourceProvider {
			continue // gap-filling only: never override user, sidecar or embedded
		}
		if err := q.UpsertMetadataValue(ctx, sqlcgen.UpsertMetadataValueParams{SubjectKind: SubjectKind(f), SubjectID: subject(rec, f),
			Field: f, Source: SourceProvider, Value: m.Fields[f]}); err != nil {
			return nil, err
		}
		applied = append(applied, f)
	}
	return applied, e.Apply(ctx, recID)
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
		_, err = e.ApplyMatch(ctx, rec, c.Matches[*index])
		return err
	}
	return apperr.Validation("action must be apply or reject")
}

// Candidate is one provider result for a person to review. Consistent reports
// whether its title and authors agree with the query; it never authorizes an
// automatic change.
type Candidate struct {
	Match
	Consistent bool
}

// ProviderResult is what one enabled provider returned. Status is ok, no_match, unavailable (the provider failed,
// was rate limited or timed out) or unconfigured (the library lists it but the operator has not set it up).
// Cached reports that the candidates came from the short-lived search cache.
type ProviderResult struct {
	Provider   string
	Status     string
	Cached     bool
	Candidates []Candidate
}

// SearchOutcome lists the providers a library has enabled, in its order. When
// none is enabled Enabled is false and no provider was contacted (ADR-0049).
type SearchOutcome struct {
	Enabled bool
	// TitleMatch is the library's setting that lets auto-fill use one clear title-and-author match (ADR-0090).
	TitleMatch bool
	Results    []ProviderResult
}

// SearchOptions select the providers searched and whether the cache is bypassed.
type SearchOptions struct {
	// Audio includes Audnexus; an ebook search leaves it out.
	Audio bool
	// Fresh ignores cached results and refreshes them.
	Fresh bool
	// Only limits the search to these providers; empty searches every enabled one.
	Only []string
}

var knownProviders = map[string]bool{ProviderOpenLibrary: true, ProviderGoogleBooks: true, ProviderAudnexus: true, ProviderHardcover: true}

// Search looks one query up with the library's enabled providers for a person
// to review (ADR-0060). It stores nothing and changes no value. A cancelled
// context is returned as an error; any other provider failure becomes an
// unavailable result for that provider and is not cached.
func (e *Enricher) Search(ctx context.Context, lib uuid.UUID, q Query, opts SearchOptions) (SearchOutcome, error) {
	cfg, err := sqlcgen.New(e.Pool).GetLibraryConfig(ctx, lib)
	if err != nil {
		return SearchOutcome{}, err
	}
	out := SearchOutcome{Results: []ProviderResult{}, TitleMatch: cfg.AutofillTitleMatch}
	for _, name := range cfg.ProviderOrder {
		if !knownProviders[name] || (name == ProviderAudnexus && !opts.Audio) {
			continue
		}
		out.Enabled = true
		if len(opts.Only) > 0 && !slices.Contains(opts.Only, name) {
			continue
		}
		res := ProviderResult{Provider: name, Status: "ok", Candidates: []Candidate{}}
		p, ok := e.Providers[name]
		if !ok {
			res.Status = "unconfigured"
			out.Results = append(out.Results, res)
			continue
		}
		key := searchKey(name, q)
		matches, hit := []Match(nil), false
		if !opts.Fresh {
			matches, hit = e.cached(key)
		}
		if !hit {
			var lerr error
			matches, lerr = p.Lookup(ctx, q)
			if ctx.Err() != nil {
				return SearchOutcome{}, ctx.Err()
			}
			if lerr != nil {
				res.Status = "unavailable"
				out.Results = append(out.Results, res)
				continue
			}
			if len(matches) > 5 {
				matches = matches[:5]
			}
			e.remember(key, matches)
		}
		res.Cached = hit
		if len(matches) == 0 {
			res.Status = "no_match"
		}
		for _, m := range matches {
			res.Candidates = append(res.Candidates, Candidate{Match: m, Consistent: consistent(m, q.Title, q.Authors)})
		}
		out.Results = append(out.Results, res)
	}
	return out, nil
}

// How auto-fill accepted a match.
const (
	RuleIdentifier  = "identifier"
	RuleTitleAuthor = "title_author"
)

// PickAutoFill chooses the one match auto-fill may offer. ADR-0060/0087: the first provider, in the library's order,
// whose only candidate is an exact identifier match that agrees with the stored title and authors. ADR-0090, only when
// the library has turned it on and no candidate matched by identifier: the best-ranked candidate that has the same title
// as the book and all of its stored authors (and the same language when both state one), taken from the first provider in
// the library's order that has one. A partial title, other authors or a provider that failed never block it, and a
// candidate that would fill nothing (useful reports false) is skipped in favour of the next one.
// It returns the match, the outcome (filled, needs_review, no_match or disabled) and the rule that accepted it.
func PickAutoFill(out SearchOutcome, q Query, language string, useful func(Match) bool) (Match, string, string) {
	if !out.Enabled {
		return Match{}, "disabled", ""
	}
	any, byID := false, false
	for _, r := range out.Results {
		if r.Status != "ok" {
			continue
		}
		if len(r.Candidates) > 0 {
			any = true
		}
		for _, c := range r.Candidates {
			byID = byID || c.ByIdentifier
		}
		if len(r.Candidates) == 1 && r.Candidates[0].ByIdentifier && r.Candidates[0].Consistent {
			return r.Candidates[0].Match, "filled", RuleIdentifier
		}
	}
	if out.TitleMatch && !byID {
		for _, r := range out.Results {
			if r.Status != "ok" {
				continue
			}
			for _, c := range r.Candidates {
				if titleAuthorMatch(c.Match, q, language) && (useful == nil || useful(c.Match)) {
					return c.Match, "filled", RuleTitleAuthor
				}
			}
		}
	}
	if any {
		return Match{}, "needs_review", ""
	}
	return Match{}, "no_match", ""
}

// titleAuthorMatch is the ADR-0090 test: the same title after normalisation, every stored author among the candidate's
// authors, and the same language when both sides state one.
func titleAuthorMatch(m Match, q Query, language string) bool {
	var title string
	if json.Unmarshal(m.Fields[FieldTitle], &title) != nil || norm(title) == "" || norm(title) != norm(q.Title) {
		return false
	}
	var authors []string
	if json.Unmarshal(m.Fields[FieldAuthors], &authors) != nil || len(authors) == 0 || len(q.Authors) == 0 {
		return false
	}
	have := map[string]bool{}
	for _, a := range authors {
		have[norm(a)] = true
	}
	for _, a := range q.Authors {
		if !have[norm(a)] {
			return false
		}
	}
	var lang string
	if language != "" && json.Unmarshal(m.Fields[FieldLanguage], &lang) == nil && lang != "" && langKey(lang) != langKey(language) {
		return false
	}
	return true
}

// langKey reduces en, eng and en-US to the same key.
func langKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) > 2 {
		s = s[:2]
	}
	return s
}

// GapFields returns the values of a match a recording has no non-provider value for, which is what auto-fill would
// store, without storing anything.
func (e *Enricher) GapFields(ctx context.Context, recID uuid.UUID, m Match) (map[string]json.RawMessage, error) {
	existing, err := e.Report(ctx, recID)
	if err != nil {
		return nil, err
	}
	out := map[string]json.RawMessage{}
	for f, v := range m.Fields {
		if !Valid(f) {
			continue
		}
		if cur, has := existing[f]; has && cur.Source != SourceProvider {
			continue
		}
		out[f] = v
	}
	return out, nil
}

// RecordingQuery builds the lookup for one recording from its effective title, authors and ISBN, and from the
// ASIN or ISBN stored as its title's identifier. It also returns the recording's library.
func (e *Enricher) RecordingQuery(ctx context.Context, recID uuid.UUID) (uuid.UUID, Query, error) {
	q := sqlcgen.New(e.Pool)
	rec, err := q.GetRecordingRow(ctx, recID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, Query{}, apperr.ErrNotFound
	}
	if err != nil {
		return uuid.Nil, Query{}, err
	}
	title, err := q.GetTitleRow(ctx, rec.TitleID)
	if err != nil {
		return uuid.Nil, Query{}, err
	}
	out := Query{Title: title.Title, Authors: title.Authors}
	if title.Identifier != nil {
		out.ISBN, out.ASIN = SplitIdentifier(*title.Identifier)
	}
	eff, err := e.Report(ctx, recID)
	if err != nil {
		return uuid.Nil, Query{}, err
	}
	if v, ok := eff[FieldTitle]; ok && !v.Cleared {
		var s string
		if json.Unmarshal(v.Raw, &s) == nil && strings.TrimSpace(s) != "" {
			out.Title = s
		}
	}
	if v, ok := eff[FieldAuthors]; ok && !v.Cleared {
		var a []string
		if json.Unmarshal(v.Raw, &a) == nil && len(a) > 0 {
			out.Authors = a
		}
	}
	if v, ok := eff[FieldISBN]; ok && !v.Cleared {
		var s string
		if json.Unmarshal(v.Raw, &s) == nil && s != "" {
			out.ISBN, _ = SplitIdentifier(s)
		}
	}
	return rec.LibraryID, out, nil
}
