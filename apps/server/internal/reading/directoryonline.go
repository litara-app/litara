package reading

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

const (
	// matchField removes a series' match through the details save.
	matchField = "match"

	coverWorkers   = 4
	coverDeadline  = 30 * time.Second
	maxCandidates  = 3
	maxOnlineCache = 128
)

// peopleOrder is the order providers are asked in: Hardcover first, Open Library only when Hardcover gives nothing
// (ADR-0102, ADR-0103).
var peopleOrder = []string{metadata.ProviderHardcover, metadata.ProviderOpenLibrary}

// Online is what author and series lookups need.
type Online struct {
	// Providers holds the configured ones. One a library enables but that is missing here is reported unconfigured.
	Providers map[string]metadata.PeopleProvider
	// Image fetches a provider's picture from a public address and returns it re-encoded (ADR-0086, ADR-0105).
	Image    func(ctx context.Context, url string) ([]byte, error)
	CacheTTL time.Duration
	Now      func() time.Time

	mu    sync.Mutex
	cache map[string]onlineCached
}

type onlineCached struct {
	value   any
	expires time.Time
}

// PeopleProviders picks the providers that have author and series data.
func PeopleProviders(all map[string]metadata.Provider) map[string]metadata.PeopleProvider {
	out := map[string]metadata.PeopleProvider{}
	for name, p := range all {
		if people, ok := p.(metadata.PeopleProvider); ok {
			out[name] = people
		}
	}
	return out
}

// EnableOnline turns author and series lookups on.
func (s *Service) EnableOnline(o *Online) { s.online = o }

func (o *Online) now() time.Time {
	if o.Now != nil {
		return o.Now()
	}
	return time.Now()
}

// cached returns a successful result kept for a few minutes, or fetches it (ADR-0087). Failures are never kept.
func cached[T any](o *Online, key string, fresh bool, fetch func() (T, error)) (T, error) {
	if o.CacheTTL > 0 && !fresh {
		o.mu.Lock()
		c, ok := o.cache[key]
		o.mu.Unlock()
		if ok && o.now().Before(c.expires) {
			if v, ok := c.value.(T); ok {
				return v, nil
			}
		}
	}
	v, err := fetch()
	if err != nil || o.CacheTTL <= 0 {
		return v, err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.cache == nil || len(o.cache) >= maxOnlineCache {
		o.cache = map[string]onlineCached{}
	}
	o.cache[key] = onlineCached{value: v, expires: o.now().Add(o.CacheTTL)}
	return v, nil
}

// enabledPeople are the providers that may be asked about this author or series, in the order they are asked.
func (s *Service) enabledPeople(ctx context.Context, user uuid.UUID, kind string, n sqlcgen.DirectoryNameRow) ([]string, error) {
	enabled, err := s.q.DirectoryProviders(ctx, sqlcgen.DirectoryProvidersParams{UserID: user, Kind: kind, NameKey: n.NameKey})
	if err != nil {
		return nil, dbErr(err)
	}
	out := []string{}
	for _, name := range peopleOrder {
		if slices.Contains(enabled, name) {
			out = append(out, name)
		}
	}
	return out, nil
}

// LookupAuthor asks for an author by name. It saves nothing.
func (s *Service) LookupAuthor(ctx context.Context, user uuid.UUID, name string, fresh bool) (wire.AuthorLookupResults, error) {
	out := wire.AuthorLookupResults{Results: []wire.ProviderAuthors{}}
	n, err := s.directoryName(ctx, user, KindAuthor, name)
	if err != nil {
		return out, err
	}
	providers, err := s.enabledPeople(ctx, user, KindAuthor, n)
	if err != nil {
		return out, err
	}
	out.Enabled = len(providers) > 0
	for _, providerName := range providers {
		res := wire.ProviderAuthors{Provider: providerName, Status: "unconfigured", Candidates: []wire.AuthorCandidate{}}
		var p metadata.PeopleProvider
		if s.online != nil {
			p = s.online.Providers[providerName]
		}
		if p != nil {
			hits, err := cached(s.online, "authors\x00"+providerName+"\x00"+n.NameKey, fresh, func() ([]metadata.AuthorHit, error) {
				return p.FindAuthors(ctx, n.Name)
			})
			if ctx.Err() != nil {
				return out, ctx.Err()
			}
			switch {
			case err != nil:
				res.Status = "unavailable"
			case len(hits) == 0:
				res.Status = "no_match"
			default:
				res.Status = "ok"
			}
			for _, h := range hits {
				res.Candidates = append(res.Candidates, wire.AuthorCandidate{ID: h.ID, Name: h.Name, Detail: h.Detail, URL: h.PageURL,
					Biography: h.Biography, HasPhoto: h.PhotoURL != ""})
			}
		}
		out.Results = append(out.Results, res)
		if res.Status == "ok" {
			break
		}
	}
	return out, nil
}

// LookupSeries finds a series through a few of the books already in it, using any book a provider matches (ADR-0103).
// It saves nothing.
func (s *Service) LookupSeries(ctx context.Context, user uuid.UUID, name string, fresh bool) (wire.SeriesLookupResults, error) {
	out := wire.SeriesLookupResults{Results: []wire.ProviderSeries{}}
	n, err := s.directoryName(ctx, user, KindSeries, name)
	if err != nil {
		return out, err
	}
	providers, err := s.enabledPeople(ctx, user, KindSeries, n)
	if err != nil {
		return out, err
	}
	out.Enabled = len(providers) > 0
	books, err := s.q.SeriesLookupBooks(ctx, sqlcgen.SeriesLookupBooksParams{UserID: user, NameKey: n.NameKey})
	if err != nil {
		return out, dbErr(err)
	}
	for _, providerName := range providers {
		res := wire.ProviderSeries{Provider: providerName, Status: "unconfigured", Candidates: []wire.SeriesCandidate{}}
		var p metadata.PeopleProvider
		if s.online != nil {
			p = s.online.Providers[providerName]
		}
		if p != nil {
			res.Status, res.Candidates, err = s.findSeries(ctx, p, books, fresh)
			if err != nil {
				return out, err
			}
		}
		out.Results = append(out.Results, res)
		if res.Status == "ok" {
			break
		}
	}
	return out, nil
}

// findSeries counts which series the books point at, then reads the most common ones for review. A provider failure is
// a status, not an error; only a cancelled request is returned as one.
func (s *Service) findSeries(ctx context.Context, p metadata.PeopleProvider, books []sqlcgen.SeriesLookupBooksRow, fresh bool) (string, []wire.SeriesCandidate, error) {
	none := []wire.SeriesCandidate{}
	count := map[string]int{}
	order := []string{}
	searched, failed := 0, 0
	for _, b := range books {
		q := metadata.Query{Title: b.Title, Authors: b.Authors}
		q.ISBN, _ = metadata.SplitIdentifier(b.Isbn)
		refs, err := cached(s.online, strings.Join([]string{"book", p.Name(), q.ISBN, q.Title, strings.Join(q.Authors, ",")}, "\x00"), fresh,
			func() ([]metadata.SeriesRef, error) { return p.BookSeries(ctx, q) })
		if ctx.Err() != nil {
			return "", none, ctx.Err()
		}
		if err != nil {
			failed++
			continue
		}
		searched++
		seen := map[string]bool{}
		for _, r := range refs {
			if seen[r.ID] {
				continue
			}
			seen[r.ID] = true
			if count[r.ID] == 0 {
				order = append(order, r.ID)
			}
			count[r.ID]++
		}
	}
	if len(order) == 0 {
		if searched == 0 && failed > 0 {
			return "unavailable", none, nil
		}
		return "no_match", none, nil
	}
	sort.SliceStable(order, func(i, j int) bool { return count[order[i]] > count[order[j]] })
	out := []wire.SeriesCandidate{}
	for _, id := range order {
		if len(out) == maxCandidates {
			break
		}
		info, err := s.seriesInfo(ctx, p, id, fresh)
		if ctx.Err() != nil {
			return "", none, ctx.Err()
		}
		if err != nil {
			continue
		}
		c := wire.SeriesCandidate{ID: id, Name: info.Name, URL: info.PageURL, Authors: append([]string{}, info.Authors...), Description: info.Description,
			NumberedBooks: len(info.Members), MatchedBooks: count[id], SearchedBooks: searched}
		if info.BookCount > 0 {
			c.BookCount = &info.BookCount
		}
		if info.Status != "" {
			c.Status = &info.Status
		}
		out = append(out, c)
	}
	if len(out) == 0 {
		return "unavailable", none, nil
	}
	return "ok", out, nil
}

func (s *Service) seriesInfo(ctx context.Context, p metadata.PeopleProvider, id string, fresh bool) (metadata.SeriesInfo, error) {
	return cached(s.online, "series\x00"+p.Name()+"\x00"+id, fresh, func() (metadata.SeriesInfo, error) { return p.Series(ctx, id) })
}

func (s *Service) author(ctx context.Context, p metadata.PeopleProvider, id string) (metadata.AuthorHit, error) {
	return cached(s.online, "author\x00"+p.Name()+"\x00"+id, false, func() (metadata.AuthorHit, error) { return p.Author(ctx, id) })
}

// peopleProvider is a provider the user may use for this author or series.
func (s *Service) peopleProvider(ctx context.Context, user uuid.UUID, kind string, n sqlcgen.DirectoryNameRow, name string) (metadata.PeopleProvider, error) {
	enabled, err := s.enabledPeople(ctx, user, kind, n)
	if err != nil {
		return nil, err
	}
	if !slices.Contains(enabled, name) || s.online == nil || s.online.Providers[name] == nil {
		return nil, apperr.New(http.StatusConflict, "provider_not_enabled", "No library of this "+kind+" has that provider enabled and set up.")
	}
	return s.online.Providers[name], nil
}

func providerError(err error) error {
	if errors.Is(err, metadata.ErrNoSuchRecord) {
		return apperr.ErrNotFound
	}
	return apperr.New(http.StatusServiceUnavailable, "provider_unavailable", "The provider could not be reached. Try again later.")
}

// AuthorCandidatePhoto fetches a candidate's photo for review only, so the browser never contacts a provider.
func (s *Service) AuthorCandidatePhoto(ctx context.Context, user uuid.UUID, name, providerName, id string) ([]byte, error) {
	n, err := s.directoryName(ctx, user, KindAuthor, name)
	if err != nil {
		return nil, err
	}
	p, err := s.peopleProvider(ctx, user, KindAuthor, n, providerName)
	if err != nil {
		return nil, err
	}
	hit, err := s.author(ctx, p, id)
	if err != nil {
		return nil, providerError(err)
	}
	if hit.PhotoURL == "" {
		return nil, apperr.ErrNotFound
	}
	return s.online.Image(ctx, hit.PhotoURL)
}

// checkApply validates a request and that the values asked for exist.
func checkApply(w wire.DirectoryApply, kind string, offered map[string]any) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	for _, f := range w.Fields {
		v, ok := offered[f]
		if !ok || !validDirectoryField(kind, f) {
			return nil, apperr.Validation("The provider record has no " + f + " to apply.")
		}
		if _, twice := out[f]; twice {
			return nil, apperr.Validation("Each field can be chosen once.")
		}
		out[f] = wire.Raw(v)
	}
	return out, nil
}

// applyValues stores provider values as saved edits that keep where they came from (ADR-0097). It refuses before
// writing anything if a chosen field is locked.
func applyValues(ctx context.Context, q *sqlcgen.Queries, kind, key string, user uuid.UUID, current wire.DirectoryDetails,
	values map[string]json.RawMessage, provider, url string, photo bool) (*apperr.Error, error) {
	for _, f := range current.Fields {
		if _, chosen := values[f.Field]; chosen && f.Locked {
			return metadata.FieldLocked(f.Field), nil
		}
	}
	if photo && current.Photo != nil && current.Photo.Locked {
		return metadata.FieldLocked(photoField), nil
	}
	for field, value := range values {
		if err := q.UpsertDirectoryValue(ctx, sqlcgen.UpsertDirectoryValueParams{Kind: kind, NameKey: key, Field: field, Value: value,
			UpdatedBy: uuid.NullUUID{UUID: user, Valid: true}, Provider: &provider, ProviderUrl: &url}); err != nil {
			return nil, err
		}
	}
	return nil, nil
}

// ApplyAuthor saves the chosen values, and the photo if asked, from one provider record.
func (s *Service) ApplyAuthor(ctx context.Context, a Actor, name string, w wire.DirectoryApply) (wire.DirectoryDetails, error) {
	var none wire.DirectoryDetails
	if len(w.Fields) == 0 && !w.Photo {
		return none, apperr.Validation("Choose at least one value to apply.")
	}
	n, err := s.directoryName(ctx, a.UserID, KindAuthor, name)
	if err != nil {
		return none, err
	}
	p, err := s.peopleProvider(ctx, a.UserID, KindAuthor, n, w.Provider)
	if err != nil {
		return none, err
	}
	hit, err := s.author(ctx, p, w.CandidateID)
	if err != nil {
		return none, providerError(err)
	}
	offered := map[string]any{}
	if hit.Biography != "" {
		offered["biography"] = hit.Biography
	}
	values, err := checkApply(w, KindAuthor, offered)
	if err != nil {
		return none, err
	}
	var photo []byte
	if w.Photo {
		if hit.PhotoURL == "" {
			return none, apperr.Validation("The provider record has no photo to apply.")
		}
		if photo, err = s.online.Image(ctx, hit.PhotoURL); err != nil {
			return none, err
		}
	}
	fp := fingerprint(http.MethodPost, "/directory/author/"+n.NameKey+"/apply", w)
	return s.mutateDirectory(ctx, a, KindAuthor, n, w.OperationID, w.BaseRevision, fp, func(q *sqlcgen.Queries) (*apperr.Error, error) {
		current, err := s.directoryReport(ctx, q, KindAuthor, n)
		if err != nil {
			return nil, err
		}
		if d, err := applyValues(ctx, q, KindAuthor, n.NameKey, a.UserID, current, values, w.Provider, hit.PageURL, w.Photo); d != nil || err != nil {
			return d, err
		}
		if photo == nil {
			return nil, nil
		}
		return nil, q.UpsertAuthorPhoto(ctx, sqlcgen.UpsertAuthorPhotoParams{NameKey: n.NameKey, Source: "provider", Image: photo,
			UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}, Provider: &w.Provider, ProviderUrl: &hit.PageURL})
	})
}

// memberCovers fetches the covers of a series' books, a few at a time. A cover that cannot be had in time is left out;
// the book then shows without one.
func (s *Service) memberCovers(ctx context.Context, members []metadata.SeriesMember) [][]byte {
	ctx, cancel := context.WithTimeout(ctx, coverDeadline)
	defer cancel()
	out := make([][]byte, len(members))
	slots := make(chan struct{}, coverWorkers)
	var wg sync.WaitGroup
	for i, m := range members {
		if m.CoverURL == "" {
			continue
		}
		wg.Add(1)
		slots <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			if img, err := s.online.Image(ctx, m.CoverURL); err == nil {
				out[i] = img
			}
		}()
	}
	wg.Wait()
	return out
}

// ApplySeries records the reviewed match with the provider's list of numbered books, and saves the chosen values
// (ADR-0103). Nothing is created in the catalog.
func (s *Service) ApplySeries(ctx context.Context, a Actor, name string, w wire.DirectoryApply) (wire.DirectoryDetails, error) {
	var none wire.DirectoryDetails
	if w.Photo {
		return none, apperr.Validation("A series has no photo.")
	}
	n, err := s.directoryName(ctx, a.UserID, KindSeries, name)
	if err != nil {
		return none, err
	}
	p, err := s.peopleProvider(ctx, a.UserID, KindSeries, n, w.Provider)
	if err != nil {
		return none, err
	}
	info, err := s.seriesInfo(ctx, p, w.CandidateID, false)
	if err != nil {
		return none, providerError(err)
	}
	offered := map[string]any{}
	if info.Description != "" {
		offered["description"] = info.Description
	}
	if info.BookCount > 0 {
		offered["book_count"] = info.BookCount
	}
	if info.Status != "" {
		offered["status"] = info.Status
	}
	values, err := checkApply(w, KindSeries, offered)
	if err != nil {
		return none, err
	}
	covers := s.memberCovers(ctx, info.Members)
	fp := fingerprint(http.MethodPost, "/directory/series/"+n.NameKey+"/apply", w)
	return s.mutateDirectory(ctx, a, KindSeries, n, w.OperationID, w.BaseRevision, fp, func(q *sqlcgen.Queries) (*apperr.Error, error) {
		current, err := s.directoryReport(ctx, q, KindSeries, n)
		if err != nil {
			return nil, err
		}
		if d, err := applyValues(ctx, q, KindSeries, n.NameKey, a.UserID, current, values, w.Provider, info.PageURL, false); d != nil || err != nil {
			return d, err
		}
		if err := q.UpsertSeriesMatch(ctx, sqlcgen.UpsertSeriesMatchParams{NameKey: n.NameKey, Provider: w.Provider, ProviderRef: w.CandidateID,
			ProviderName: info.Name, Url: info.PageURL, MatchedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}}); err != nil {
			return nil, err
		}
		if err := q.DeleteSeriesMembers(ctx, n.NameKey); err != nil {
			return nil, err
		}
		for i, m := range info.Members {
			if err := q.InsertSeriesMember(ctx, sqlcgen.InsertSeriesMemberParams{NameKey: n.NameKey, Position: int32(m.Position), Title: m.Title,
				Authors: append([]string{}, m.Authors...), Released: m.Released, Url: m.PageURL, Cover: covers[i]}); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
}

// released reports whether a book is out. One without a date cannot be confirmed and is left out (ADR-0104).
func released(date string, now time.Time) bool {
	switch len(date) {
	case 4:
		return date <= now.Format("2006")
	case 7:
		return date <= now.Format("2006-01")
	case 10:
		return date <= now.Format("2006-01-02")
	}
	return false
}

func authorKey(name string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, name)
}

// ownedMember reports whether the viewer holds a member: a book in the series with its number, or a book of the same
// title that is in the series or by the same author, whatever its edition or numbering.
func ownedMember(m sqlcgen.ListSeriesMembersRow, owned []sqlcgen.OwnedForSeriesRow) bool {
	for _, o := range owned {
		if o.InSeries && o.SeriesIndex != nil && *o.SeriesIndex == float64(m.Position) {
			return true
		}
		if metadata.SameTitle(o.Title, m.Title) && (o.InSeries || metadata.SharesAuthor(o.Authors, m.Authors)) {
			return true
		}
	}
	return false
}

// MissingBooks lists the released books of a matched series that none of the viewer's libraries holds.
func (s *Service) MissingBooks(ctx context.Context, user uuid.UUID, name string) (wire.MissingBooks, error) {
	out := wire.MissingBooks{Items: []wire.MissingBook{}}
	n, err := s.directoryName(ctx, user, KindSeries, name)
	if err != nil {
		return out, err
	}
	match, err := s.q.GetSeriesMatch(ctx, n.NameKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, dbErr(err)
	}
	out.Match = &wire.SeriesMatch{Provider: match.Provider, Name: match.ProviderName, URL: match.Url}
	members, err := s.q.ListSeriesMembers(ctx, n.NameKey)
	if err != nil {
		return out, dbErr(err)
	}
	keys := []string{}
	for _, m := range members {
		for _, a := range m.Authors {
			if k := authorKey(a); k != "" && !slices.Contains(keys, k) {
				keys = append(keys, k)
			}
		}
	}
	owned, err := s.q.OwnedForSeries(ctx, sqlcgen.OwnedForSeriesParams{UserID: user, NameKey: n.NameKey, AuthorKeys: keys})
	if err != nil {
		return out, dbErr(err)
	}
	now := s.now()
	for _, m := range members {
		if !released(m.Released, now) || ownedMember(m, owned) {
			continue
		}
		item := wire.MissingBook{Number: int(m.Position), Title: m.Title, Authors: append([]string{}, m.Authors...), Released: m.Released, URL: m.Url}
		if m.CoverVersion.Valid {
			v := m.CoverVersion.UUID.String()
			item.CoverVersion = &v
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

// MissingCover is the stored cover of a member of a series the viewer can see.
func (s *Service) MissingCover(ctx context.Context, user uuid.UUID, name, number string) ([]byte, uuid.UUID, error) {
	n, err := s.directoryName(ctx, user, KindSeries, name)
	if err != nil {
		return nil, uuid.Nil, err
	}
	position, err := strconv.Atoi(number)
	if err != nil {
		return nil, uuid.Nil, apperr.ErrNotFound
	}
	row, err := s.q.GetSeriesMemberCover(ctx, sqlcgen.GetSeriesMemberCoverParams{NameKey: n.NameKey, Position: int32(position)})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.Cover == nil) {
		return nil, uuid.Nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, uuid.Nil, dbErr(err)
	}
	return row.Cover, row.CoverVersion.UUID, nil
}
