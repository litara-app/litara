package paperimport

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Every file here is made up. Nobody's real export is committed (ADR-0117).

func TestReadFindsColumnsByNameAndNamesWhatItCannotRead(t *testing.T) {
	data := "\xef\xbb\xbf" + `Private Notes,exclusive shelf,Title,Book Id,Author,Additional Authors,ISBN,ISBN13,My Rating,My Review,Date Read,Owned Copies,Bookshelves,Binding,Number of Pages,Year Published,Unknown
secret note,read,"Paper, Walls",1,Nell Printed,"Ann Other, Bo Third","=""0306406152""","=""9780306406157""",4,"Two<br/>lines
and a third",2025/03/04,2,"paper-shelf, favourites",Mass Market Paperback,320,1999,x
,to-read,Second,2,,,="",="",0,,,0,,Kindle Edition,,,
,currently-reading,Third,3,A,,12345,,9,,03/04/2025,lots,,Spiral-bound,many,99,

,,,4,Nobody,,,,,,,,,,,,
`
	source, rows, err := Read([]byte(data))
	if err != nil || source != SourceGoodreads || len(rows) != 4 {
		t.Fatalf("read: %v %s %d", err, source, len(rows))
	}
	a := rows[0]
	if a.Title != "Paper, Walls" || !slices.Equal(a.Authors, []string{"Nell Printed", "Ann Other", "Bo Third"}) || a.ISBN != "9780306406157" ||
		a.Rating != 4 || a.Review != "Two\nlines\nand a third" || a.DateRead != "2025-03-04" || a.OwnedCopies != 2 || a.Copies() != 2 ||
		!slices.Equal(a.Shelves, []string{"read", "paper-shelf", "favourites"}) || a.Binding != "paperback" || a.Pages != 320 || a.Published != "1999" ||
		len(a.Problems) != 0 || !a.HasReading() {
		t.Fatalf("first: %+v", a)
	}
	if strings.Contains(strings.Join([]string{a.Title, a.Review, a.Publisher, a.Location}, " "), "secret") {
		t.Fatal("private notes were read")
	}
	if b := rows[1]; b.ISBN != "" || b.Binding != "" || b.Rating != 0 || b.HasReading() || b.Copies() != 1 || len(b.Problems) != 1 {
		t.Fatalf("second: %+v", b)
	}
	c := rows[2]
	if c.ISBN != "" || c.Rating != 0 || c.DateRead != "" || c.OwnedCopies != 0 || c.Pages != 0 || c.Published != "" || c.Binding != "other" {
		t.Fatalf("third: %+v", c)
	}
	if _, bare, err := Read([]byte("Title,ISBN,ISBN13,Author\r\nBare,=\"0306406152\",=\"9780306406157\",Z\r\nNone,=\"\",=\"\",\r\n")); err != nil ||
		bare[0].ISBN != "9780306406157" || bare[0].Authors[0] != "Z" || bare[1].ISBN != "" || len(bare[1].Problems) != 0 {
		t.Fatalf("bare wrappers: %v %+v", err, bare)
	}
	for _, want := range []string{"ISBN", "rating", "date read", "owned copies", "page count"} {
		if !strings.Contains(strings.Join(c.Problems, " "), want) {
			t.Fatalf("no problem about %s: %v", want, c.Problems)
		}
	}
	if d := rows[3]; d.Usable() || len(d.Problems) != 1 || d.Number != 5 {
		t.Fatalf("a row without a title: %+v", d)
	}
}

func TestReadRefusesFilesItCannotUse(t *testing.T) {
	for name, data := range map[string]string{
		"empty": "", "no title column": "Name,Author\nx,y\n", "only a header": "Title\n", "not utf-8": "Title\n\xff\xfe\n",
		"broken quotes": "Title\n\"unclosed\n", "too many rows": "Title\n" + strings.Repeat("a\n", MaxRows+1),
		"too large": "Title\n" + strings.Repeat("a", MaxBytes),
	} {
		var refused FileError
		if _, _, err := Read([]byte(data)); !errors.As(err, &refused) || refused.Reason == "" {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if _, rows, err := Read([]byte("Title\n" + strings.Repeat("a\n", MaxRows))); err != nil || len(rows) != MaxRows {
		t.Fatalf("the largest file: %v %d", err, len(rows))
	}
	source, rows, err := Read([]byte(strings.Join(TemplateHeader, ",") + "\nMine,Me,,,hardback,,,,12,Loft,Stacks,2.5\n"))
	if err != nil || source != SourceLitara || rows[0].Location != "Loft" || rows[0].Series != "Stacks" || *rows[0].SeriesIndex != 2.5 ||
		rows[0].Copies() != 10 || rows[0].Binding != "hardcover" {
		t.Fatalf("template: %v %s %+v", err, source, rows)
	}
}

func TestOwnershipOnlySelectsByTheAnswerGiven(t *testing.T) {
	r := Row{Title: "A", OwnedCopies: 1, Shelves: []string{"read", "paper"}}
	for _, c := range []struct {
		answer  string
		shelves []string
		want    bool
	}{{"", nil, false}, {OwnAll, nil, true}, {OwnMarked, nil, true}, {OwnShelves, []string{"paper"}, true}, {OwnShelves, []string{"wishlist"}, false},
		{OwnShelves, nil, false}, {OwnPick, []string{"paper"}, false}} {
		if got := Selected(r, c.answer, c.shelves); got != c.want {
			t.Fatalf("%q %v: %v", c.answer, c.shelves, got)
		}
	}
	if Selected(Row{}, OwnAll, nil) || Selected(Row{Title: "B"}, OwnMarked, nil) {
		t.Fatal("selected a row that should not be")
	}
}

func TestDecide(t *testing.T) {
	isbn := Title{ID: uuid.New(), Title: "Known", Authors: []string{"A"}, ISBNs: []string{"9780306406157"}}
	named := Title{ID: uuid.New(), Title: "Same Name!", Authors: []string{"B"}}
	held := Title{ID: uuid.New(), Title: "On Paper", Authors: []string{"C"}, ISBNs: []string{"9781402894626"}, LibraryCopies: []string{"9781402894626"}}
	plain := Title{ID: uuid.New(), Title: "No Number", Authors: []string{"D"}, LibraryCopies: []string{""}}
	x := NewIndex([]Title{isbn, named, held, plain})

	byISBN := Row{Title: "Another Name", ISBN: "9780306406157", Rating: 3}
	byName := Row{Title: "same name", Authors: []string{"b"}, Exclusive: "read"}
	again := Row{Title: "On Paper", Authors: []string{"C"}, ISBN: "9781402894626", Rating: 5}
	againPlain := Row{Title: "No Number", Authors: []string{"D"}, Rating: 5}
	fresh := Row{Title: "Brand New", Authors: []string{"E"}, Rating: 2}

	for _, c := range []struct {
		name    string
		row     Row
		d       Decision
		reading bool
		action  string
		title   uuid.UUID
	}{
		{"same ISBN attaches", byISBN, Decision{Selected: true}, false, ActionAddCopy, isbn.ID},
		{"same ISBN, said separate", byISBN, Decision{Selected: true, Choice: ChoiceSeparate}, false, ActionNewBook, uuid.Nil},
		{"name only waits for a choice", byName, Decision{Selected: true}, true, ActionNeedsChoice, uuid.Nil},
		{"name chosen", byName, Decision{Selected: true, Choice: ChoiceAttach, TitleID: named.ID}, false, ActionAddCopy, named.ID},
		{"a choice that is no longer a match", byName, Decision{Selected: true, Choice: ChoiceAttach, TitleID: isbn.ID}, false, ActionNeedsChoice, uuid.Nil},
		{"left out", byISBN, Decision{Selected: true, Choice: ChoiceSkip}, true, ActionSkip, uuid.Nil},
		{"run again", again, Decision{Selected: true}, false, ActionAlready, held.ID},
		{"run again with reading", again, Decision{Selected: true}, true, ActionReadingOnly, held.ID},
		{"run again without an ISBN", againPlain, Decision{Selected: true}, true, ActionAlready, plain.ID},
		{"another copy on purpose", again, Decision{Selected: true, Choice: ChoiceAttach, TitleID: held.ID}, false, ActionAddCopy, held.ID},
		{"new", fresh, Decision{Selected: true}, true, ActionNewBook, uuid.Nil},
		{"not owned", fresh, Decision{}, true, ActionNotOwned, uuid.Nil},
		{"not owned, same ISBN", byISBN, Decision{}, true, ActionReadingOnly, isbn.ID},
		{"not owned, same ISBN, reading not asked for", byISBN, Decision{}, false, ActionNotOwned, uuid.Nil},
		{"not owned, name only", byName, Decision{}, true, ActionNeedsChoice, uuid.Nil},
		{"not owned, name confirmed", byName, Decision{Choice: ChoiceAttach, TitleID: named.ID}, true, ActionReadingOnly, named.ID},
		{"not owned, separate", byName, Decision{Choice: ChoiceSeparate}, true, ActionNotOwned, uuid.Nil},
		{"no title", Row{}, Decision{Selected: true}, true, ActionUnusable, uuid.Nil},
	} {
		p := Decide(x, c.row, c.d, c.reading)
		if p.Action != c.action || p.TitleID != c.title {
			t.Fatalf("%s: %s %s", c.name, p.Action, p.TitleID)
		}
	}
	// Two books with one ISBN are not chosen between.
	two := NewIndex([]Title{isbn, {ID: uuid.New(), Title: "Twin", ISBNs: []string{"9780306406157"}}})
	if p := Decide(two, byISBN, Decision{Selected: true}, false); p.Action != ActionNeedsChoice || len(p.Matches) != 2 {
		t.Fatalf("two with the ISBN: %+v", p)
	}
}
