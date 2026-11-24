package metadata

import (
	"encoding/json"
	"testing"
)

func pickMatch(title string, authors ...string) Match {
	t, _ := json.Marshal(title)
	a, _ := json.Marshal(authors)
	return Match{Fields: Fields{FieldTitle: t, FieldAuthors: a}}
}

func okResult(provider string, ms ...Match) ProviderResult {
	r := ProviderResult{Provider: provider, Status: "ok", Candidates: []Candidate{}}
	for _, m := range ms {
		r.Candidates = append(r.Candidates, Candidate{Match: m})
	}
	return r
}

// ADR-0090 (revised 2026-11-22): the best-ranked exact title-and-author candidate, from the first provider that has one.
// An exact match that would fill nothing is skipped for the next provider's exact match.
func TestPickAutoFillSkipsExactMatchesThatFillNothing(t *testing.T) {
	q := Query{Title: "Treasure Island", Authors: []string{"Robert Louis Stevenson"}}
	bare := pickMatch("Treasure Island", "Robert Louis Stevenson")
	bare.ID = "bare"
	rich := pickMatch("Treasure Island", "Robert Louis Stevenson")
	rich.ID = "rich"
	rich.Fields[FieldDescription] = json.RawMessage(`"An adventure."`)
	out := SearchOutcome{Enabled: true, TitleMatch: true, Results: []ProviderResult{okResult("open_library", bare), okResult("hardcover", rich)}}
	useful := func(m Match) bool { _, ok := m.Fields[FieldDescription]; return ok }
	if m, outcome, _ := PickAutoFill(out, q, "", useful); outcome != "filled" || m.ID != "rich" {
		t.Fatalf("got %q %q", m.ID, outcome)
	}
	if _, outcome, _ := PickAutoFill(out, q, "", func(Match) bool { return false }); outcome != "needs_review" {
		t.Fatalf("nothing useful: %q", outcome)
	}
}

func TestPickAutoFillTitleAuthorTakesBestRankedExactAndIgnoresFailedProviders(t *testing.T) {
	q := Query{Title: "Treasure Island", Authors: []string{"Robert Louis Stevenson"}}
	exact := pickMatch("Treasure Island", "Robert Louis Stevenson")
	exact.ID = "first"
	later := pickMatch("Treasure Island", "Robert Louis Stevenson")
	later.ID = "later"
	partial := pickMatch("Treasure Island and Other Stories", "Robert Louis Stevenson")
	otherAuthor := pickMatch("Treasure Island", "Someone Else")

	out := SearchOutcome{Enabled: true, TitleMatch: true, Results: []ProviderResult{
		{Provider: "google_books", Status: "unavailable"},
		okResult("open_library", partial, otherAuthor, exact, later),
		okResult("hardcover", pickMatch("Treasure Island", "Robert Louis Stevenson")),
	}}
	m, outcome, rule := PickAutoFill(out, q, "", nil)
	if outcome != "filled" || rule != RuleTitleAuthor || m.ID != "first" {
		t.Fatalf("got %q %q %q", m.ID, outcome, rule)
	}

	out.TitleMatch = false
	if _, outcome, _ := PickAutoFill(out, q, "", nil); outcome != "needs_review" {
		t.Fatalf("setting off: %q", outcome)
	}

	out.TitleMatch = true
	out.Results = []ProviderResult{okResult("open_library", partial, otherAuthor)}
	if _, outcome, _ := PickAutoFill(out, q, "", nil); outcome != "needs_review" {
		t.Fatalf("no exact candidate: %q", outcome)
	}
}
