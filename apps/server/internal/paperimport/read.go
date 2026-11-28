// Package paperimport reads a CSV list of paper books and works out what importing each row would do (ADR-0117).
// It touches no database.
package paperimport

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// Limits on one file.
const (
	MaxBytes  = 10 << 20
	MaxRows   = 10000
	maxCopies = 10
)

// Where a file came from, judged only by its header names.
const (
	SourceGoodreads = "goodreads"
	SourceLitara    = "litara"
)

// Row is what one line of a file says. Values that could not be read for certain are left out and named in Problems.
// Private Notes are never read.
type Row struct {
	Number      int      `json:"number"` // the record's place in the file, counting the header as 1 and ignoring empty lines
	Title       string   `json:"title"`
	Authors     []string `json:"authors,omitempty"`
	ISBN        string   `json:"isbn,omitempty"`
	Binding     string   `json:"binding,omitempty"`
	Pages       int      `json:"pages,omitempty"`
	Publisher   string   `json:"publisher,omitempty"`
	Published   string   `json:"published,omitempty"`
	OwnedCopies int      `json:"ownedCopies,omitempty"`
	Shelves     []string `json:"shelves,omitempty"` // the exclusive shelf and every other shelf, lower-cased
	Exclusive   string   `json:"exclusive,omitempty"`
	Rating      int      `json:"rating,omitempty"` // whole stars, 0 is unrated
	Review      string   `json:"review,omitempty"`
	DateRead    string   `json:"dateRead,omitempty"` // YYYY-MM-DD
	Location    string   `json:"location,omitempty"`
	Series      string   `json:"series,omitempty"`
	SeriesIndex *float64 `json:"seriesIndex,omitempty"`
	Problems    []string `json:"problems,omitempty"`
}

// Usable reports whether the row names a book at all.
func (r Row) Usable() bool { return r.Title != "" }

// Copies is how many paper copies a selected row makes.
func (r Row) Copies() int { return min(max(r.OwnedCopies, 1), maxCopies) }

// HasReading reports whether the row says anything about the person's own reading.
func (r Row) HasReading() bool {
	return r.Rating > 0 || r.Review != "" || r.Exclusive == "read" || r.Exclusive == "currently-reading"
}

// TemplateHeader is the Litara template. It shares the Goodreads names, and adds where a copy is and its series.
var TemplateHeader = []string{"Title", "Author", "Additional Authors", "ISBN13", "Binding", "Number of Pages", "Publisher",
	"Year Published", "Owned Copies", "Location", "Series", "Series Number", "Bookshelves", "Exclusive Shelf", "My Rating",
	"My Review", "Date Read"}

// FileError refuses a whole file, in words for the person who chose it.
type FileError struct{ Reason string }

func (e FileError) Error() string { return e.Reason }

var lineBreak = regexp.MustCompile(`(?i)<br\s*/?>`)

// bareWrapper is an ISBN wrapped as ="..." without CSV quoting around it, which is not valid CSV. Only this one form is
// repaired; any other stray quote still refuses the file, so a broken quote never swallows the rows after it.
var bareWrapper = regexp.MustCompile(`(?m)(^|,)="([0-9Xx -]*)"(,|\r?$)`)

func repairWrappers(data []byte) []byte {
	for {
		next := bareWrapper.ReplaceAll(data, []byte("$1$2$3"))
		if len(next) == len(data) {
			return next // two wrappers side by side share a comma, so it takes a second pass
		}
		data = next
	}
}

// Read reads a whole file. Columns are found by header name, in any order and ignoring case; unknown ones are ignored.
func Read(data []byte) (source string, rows []Row, err error) {
	if len(data) > MaxBytes {
		return "", nil, FileError{"The file is larger than 10 MB."}
	}
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	if !utf8.Valid(data) {
		return "", nil, FileError{"The file is not UTF-8 text. Save it as a UTF-8 CSV file and try again."}
	}
	r := csv.NewReader(bytes.NewReader(repairWrappers(data)))
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if errors.Is(err, io.EOF) {
		return "", nil, FileError{"The file is empty."}
	}
	if err != nil {
		return "", nil, FileError{"The file is not a CSV file that can be read: " + err.Error()}
	}
	at := map[string]int{}
	for i, name := range header {
		key := strings.ToLower(strings.TrimSpace(name))
		if _, seen := at[key]; !seen {
			at[key] = i
		}
	}
	if _, ok := at["title"]; !ok {
		found := strings.Join(header, ", ")
		if len(found) > 300 {
			found = strings.ToValidUTF8(found[:300], "") + "…"
		}
		return "", nil, FileError{"The file has no Title column. Its first line has: " + found}
	}
	source = SourceLitara
	if _, ok := at["book id"]; ok {
		if _, ok := at["exclusive shelf"]; ok {
			source = SourceGoodreads
		}
	}
	line := 1
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		line++
		if err != nil {
			return "", nil, FileError{fmt.Sprintf("Row %d cannot be read: %v", line, err)}
		}
		if !slices.ContainsFunc(rec, func(v string) bool { return strings.TrimSpace(v) != "" }) {
			continue
		}
		if len(rows) == MaxRows {
			return "", nil, FileError{"The file has more than 10,000 books. Split it and import each part."}
		}
		rows = append(rows, readRow(line, func(name string) string {
			if i, ok := at[name]; ok && i < len(rec) {
				return strings.TrimSpace(rec[i])
			}
			return ""
		}))
	}
	if len(rows) == 0 {
		return "", nil, FileError{"The file has a header line and no books."}
	}
	return source, rows, nil
}

// unwrap removes the spreadsheet wrapping some exports put around an ISBN, ="9780306406157".
func unwrap(v string) string {
	v = strings.TrimPrefix(v, "=")
	return strings.Trim(v, `"' `)
}

func readRow(number int, get func(string) string) Row {
	row := Row{Number: number}
	problem := func(format string, a ...any) { row.Problems = append(row.Problems, fmt.Sprintf(format, a...)) }
	limited := func(name, label string, limit int) string {
		v := get(name)
		if utf8.RuneCountInString(v) > limit {
			problem("%s is longer than %d characters and was left out.", label, limit)
			return ""
		}
		return v
	}

	row.Title = limited("title", "The title", 2048)
	if row.Title == "" && len(row.Problems) == 0 {
		problem("There is no title.")
	}
	if a := limited("author", "The author", 512); a != "" {
		row.Authors = []string{a}
	}
	for _, a := range strings.Split(get("additional authors"), ",") {
		if a = strings.TrimSpace(a); a != "" && utf8.RuneCountInString(a) <= 512 && len(row.Authors) < 50 {
			row.Authors = append(row.Authors, a)
		}
	}

	// ISBN-13 first; the older column only when it gives nothing.
	var given string
	for _, name := range []string{"isbn13", "isbn"} {
		v := unwrap(get(name))
		if v == "" {
			continue
		}
		if isbn, _ := metadata.SplitIdentifier(v); isbn != "" {
			row.ISBN = isbn
			break
		}
		given = v
	}
	if row.ISBN == "" && given != "" {
		problem("The ISBN %q is not one that can be read.", clip(given, 40))
	}

	switch b := strings.ToLower(get("binding")); {
	case b == "":
	case strings.Contains(b, "hardcover") || strings.Contains(b, "hardback"):
		row.Binding = "hardcover"
	case strings.Contains(b, "paperback"):
		row.Binding = "paperback"
	case strings.Contains(b, "kindle") || strings.Contains(b, "ebook") || strings.Contains(b, "e-book") || strings.Contains(b, "audio"):
		problem("The binding %q is not a paper book. Check that you own this one on paper.", clip(get("binding"), 40))
	default:
		row.Binding = "other"
	}

	number1 := func(name, label string, low, high int) int {
		v := get(name)
		if v == "" {
			return 0
		}
		n, err := strconv.Atoi(v)
		if err != nil || n < low || n > high {
			problem("%s %q cannot be read and was left out.", label, clip(v, 40))
			return 0
		}
		return n
	}
	row.Pages = number1("number of pages", "The page count", 0, 100000)
	row.OwnedCopies = number1("owned copies", "The number of owned copies", 0, 100000)
	row.Rating = number1("my rating", "The rating", 0, 5)
	if y := number1("year published", "The publication year", 0, 9999); y >= 1000 {
		row.Published = strconv.Itoa(y)
	}
	row.Publisher = limited("publisher", "The publisher", 512)
	row.Location = limited("location", "The location", 200)
	row.Series = limited("series", "The series", 512)
	if v := get("series number"); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil && n >= 0 && n < 1e9 {
			row.SeriesIndex = &n
		} else {
			problem("The series number %q cannot be read and was left out.", clip(v, 40))
		}
	}

	row.Exclusive = strings.ToLower(limited("exclusive shelf", "The exclusive shelf", 100))
	shelves := []string{}
	if row.Exclusive != "" {
		shelves = append(shelves, row.Exclusive)
	}
	for _, s := range strings.FieldsFunc(strings.ToLower(get("bookshelves")), func(r rune) bool { return r == ',' || r == ';' }) {
		if s = strings.TrimSpace(s); s != "" && utf8.RuneCountInString(s) <= 100 && !slices.Contains(shelves, s) && len(shelves) < 100 {
			shelves = append(shelves, s)
		}
	}
	if len(shelves) > 0 {
		row.Shelves = shelves
	}

	row.Review = limited("my review", "The review", 20000)
	if row.Review != "" {
		row.Review = strings.TrimSpace(lineBreak.ReplaceAllString(row.Review, "\n"))
	}
	if v := get("date read"); v != "" {
		// Only forms with the year first are certain; 03/04/2020 could be either of two days.
		for _, layout := range []string{"2006/01/02", "2006-01-02"} {
			if t, err := time.Parse(layout, v); err == nil && t.Year() >= 1000 {
				row.DateRead = t.Format("2006-01-02")
				break
			}
		}
		if row.DateRead == "" {
			problem("The date read %q is not written year first and was left out.", clip(v, 40))
		}
	}
	return row
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
