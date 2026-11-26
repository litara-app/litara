package catalog

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// A smart shelf is a stored library filter (ADR-0107): the same tree, fields and compiler as library search, evaluated
// with the viewer's grants, reading status and rating.

// ValidateShelfFilter checks a filter before it is stored on a shelf; failures are 422. Unlike a search, a shelf may not
// hold an empty group, because an empty group matches every title.
func ValidateShelfFilter(f wire.TitleFilter) error {
	raw, err := json.Marshal(f)
	if err != nil {
		return bad("the filter is not valid")
	}
	if len(raw) > maxShelfBytes {
		return bad("the serialized filter exceeds 32 KiB")
	}
	// The compiler first: it bounds the depth and the rule count and checks every rule.
	c := &filterCompiler{}
	if _, err := c.compile(&f, 1); err != nil {
		return err
	}
	if hasEmptyGroup(f) {
		return bad("a smart shelf needs at least one rule in every group")
	}
	return nil
}

func hasEmptyGroup(f wire.TitleFilter) bool {
	if f.Type != "group" {
		return false
	}
	if len(f.Rules) == 0 {
		return true
	}
	for _, r := range f.Rules {
		if hasEmptyGroup(r) {
			return true
		}
	}
	return false
}

// SmartShelfTitleIDs evaluates a stored filter for one viewer: only titles in the viewer's granted libraries, ordered by
// title UUID. A limit of 0 returns only the total.
func (s *Service) SmartShelfTitleIDs(ctx context.Context, viewer uuid.UUID, f wire.TitleFilter, limit, offset int) ([]uuid.UUID, int64, error) {
	c := &filterCompiler{}
	c.arg(viewer) // $1
	cond, err := c.compile(&f, 1)
	if err != nil {
		return nil, 0, err
	}
	from := " FROM title_rows($1) b WHERE b.edition_count + b.recording_count > 0 AND " + cond
	var total int64
	if err := s.pool.QueryRow(ctx, "SELECT count(*)"+from, c.args...).Scan(&total); err != nil {
		return nil, 0, unavailable(err)
	}
	if limit == 0 {
		return nil, total, nil
	}
	ln, on := c.arg(limit), c.arg(offset)
	rows, err := s.pool.Query(ctx, "SELECT b.id"+from+" ORDER BY b.id LIMIT "+ln+" OFFSET "+on, c.args...)
	if err != nil {
		return nil, 0, unavailable(err)
	}
	defer rows.Close()
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, 0, unavailable(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, unavailable(err)
	}
	return ids, total, nil
}
