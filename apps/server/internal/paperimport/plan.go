package paperimport

import (
	"slices"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// The answers to "Which books in this file do you own on paper?". None is chosen for the person.
const (
	OwnAll     = "all"
	OwnMarked  = "owned"
	OwnShelves = "shelves"
	OwnPick    = "pick"
)

// Selected is whether the answer starts a row as a book owned on paper.
func Selected(r Row, ownership string, shelves []string) bool {
	if !r.Usable() {
		return false
	}
	switch ownership {
	case OwnAll:
		return true
	case OwnMarked:
		return r.OwnedCopies >= 1
	case OwnShelves:
		return slices.ContainsFunc(r.Shelves, func(s string) bool { return slices.Contains(shelves, s) })
	}
	return false
}

// What a row would do when applied.
const (
	ActionNewBook     = "new_book"     // creates the book with its copies
	ActionAddCopy     = "add_copy"     // adds copies to a book in the catalogue
	ActionReadingOnly = "reading_only" // no copy; the person's rating, review and finish date go to a catalogue book
	ActionNeedsChoice = "needs_choice" // a possible match the person has not decided; skipped as it stands
	ActionAlready     = "already"      // the book already has this paper copy in the library
	ActionNotOwned    = "not_owned"    // not owned on paper and nothing to add; listed in the report
	ActionSkip        = "skip"         // the person chose to leave the row out
	ActionUnusable    = "unusable"     // the row names no book
)

// The person's choice for a row with a possible match. Empty leaves the starting choice.
const (
	ChoiceAttach   = "attach"
	ChoiceSeparate = "separate"
	ChoiceSkip     = "skip"
)

// Title is a book the person can already see.
type Title struct {
	ID      uuid.UUID
	Title   string
	Authors []string
	ISBNs   []string
	// LibraryCopies is the ISBN, or "", of each paper copy in the library being imported into.
	LibraryCopies []string
}

// Index finds the books a row may be.
type Index struct {
	byID   map[uuid.UUID]Title
	byISBN map[string][]uuid.UUID
	byName map[string][]uuid.UUID
}

func NewIndex(titles []Title) *Index {
	x := &Index{byID: map[uuid.UUID]Title{}, byISBN: map[string][]uuid.UUID{}, byName: map[string][]uuid.UUID{}}
	for _, t := range titles {
		x.byID[t.ID] = t
		for _, isbn := range t.ISBNs {
			if isbn != "" && !slices.Contains(x.byISBN[isbn], t.ID) {
				x.byISBN[isbn] = append(x.byISBN[isbn], t.ID)
			}
		}
		key := metadata.TitleKey(t.Title, t.Authors)
		x.byName[key] = append(x.byName[key], t.ID)
	}
	return x
}

// Match is a catalogue book that may be the one a row describes.
type Match struct {
	Title    Title
	SameISBN bool
}

const maxMatches = 20

// Matches lists books with the row's ISBN first, then those with its name and first author.
func (x *Index) Matches(r Row) []Match {
	var out []Match
	seen := map[uuid.UUID]bool{}
	add := func(ids []uuid.UUID, same bool) {
		for _, id := range ids {
			if !seen[id] && len(out) < maxMatches {
				seen[id] = true
				out = append(out, Match{Title: x.byID[id], SameISBN: same})
			}
		}
	}
	if r.ISBN != "" {
		add(x.byISBN[r.ISBN], true)
	}
	if metadata.NormText(r.Title) != "" {
		add(x.byName[metadata.TitleKey(r.Title, r.Authors)], false)
	}
	return out
}

// Decision is the person's part of a row's plan.
type Decision struct {
	Selected bool
	Choice   string
	TitleID  uuid.UUID // with ChoiceAttach
}

// Plan is what a row would do.
type Plan struct {
	Action string
	// TitleID is the catalogue book for add_copy, reading_only and already.
	TitleID uuid.UUID
	Matches []Match
}

// Decide works out a row's plan. includeReading is whether the person asked for their own reading to be imported.
func Decide(x *Index, r Row, d Decision, includeReading bool) Plan {
	if !r.Usable() {
		return Plan{Action: ActionUnusable}
	}
	p := Plan{Matches: x.Matches(r)}
	if d.Choice == ChoiceSkip {
		p.Action = ActionSkip
		return p
	}
	reading := includeReading && r.HasReading()

	// Which catalogue book, if any, the row is.
	var target uuid.UUID
	undecided, separate := false, false
	switch d.Choice {
	case ChoiceAttach:
		if slices.ContainsFunc(p.Matches, func(m Match) bool { return m.Title.ID == d.TitleID }) {
			target = d.TitleID
		} else {
			undecided = true // the book chosen is no longer a match
		}
	case ChoiceSeparate:
		separate = true
	default:
		same := 0
		for _, m := range p.Matches {
			if m.SameISBN {
				same++
				target = m.Title.ID
			}
		}
		if same != 1 {
			target = uuid.Nil
			undecided = len(p.Matches) > 0
		}
	}

	// A book that already has this copy is not given another unless the person says so.
	repeat := false
	if d.Choice == "" {
		candidates := []uuid.UUID{target}
		if undecided {
			candidates = candidates[:0]
			for _, m := range p.Matches {
				candidates = append(candidates, m.Title.ID)
			}
		}
		for _, id := range candidates {
			if id != uuid.Nil && slices.Contains(x.byID[id].LibraryCopies, r.ISBN) {
				repeat, target, undecided = true, id, false
				break
			}
		}
	}

	p.TitleID = target
	switch {
	case d.Selected && undecided:
		p.Action = ActionNeedsChoice
	case d.Selected && repeat:
		p.Action = ActionAlready
		if reading && sameISBN(p.Matches, target) {
			p.Action = ActionReadingOnly
		}
	case d.Selected && target != uuid.Nil:
		p.Action = ActionAddCopy
	case d.Selected:
		p.Action = ActionNewBook
	case reading && undecided:
		p.Action = ActionNeedsChoice
	case reading && target != uuid.Nil && !separate && (d.Choice == ChoiceAttach || sameISBN(p.Matches, target)):
		p.Action = ActionReadingOnly
	default:
		p.Action = ActionNotOwned
		p.TitleID = uuid.Nil
	}
	if p.Action == ActionNeedsChoice {
		p.TitleID = uuid.Nil
	}
	return p
}

func sameISBN(matches []Match, id uuid.UUID) bool {
	return slices.ContainsFunc(matches, func(m Match) bool { return m.Title.ID == id && m.SameISBN })
}

// GroupKeys are what two rows share when they describe the same new book.
func GroupKeys(r Row) []string {
	keys := []string{"name:" + metadata.TitleKey(r.Title, r.Authors)}
	if r.ISBN != "" {
		keys = append(keys, "isbn:"+r.ISBN)
	}
	return keys
}
