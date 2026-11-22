// Package notices stores each account's notification history (ADR-0089).
package notices

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

// Retention: the newest 500 entries or 90 days, whichever is fewer (ADR-0089).
const (
	MaxEntries = 500
	MaxAge     = 90 * 24 * time.Hour
)

// Tones and sources a notification may have.
const (
	SourceUser   = "user"
	SourceSystem = "system"
)

var tones = map[string]bool{"success": true, "info": true, "warning": true, "error": true}

type Notice struct {
	ID     uuid.UUID
	Tone   string
	Title  string
	Detail string
	Source string
	Read   bool
	At     time.Time
}

type Service struct {
	Pool *pgxpool.Pool
	Now  func() time.Time
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool, Now: time.Now} }

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func fromRow(id uuid.UUID, tone, title string, detail *string, source string, readAt *time.Time, at time.Time) Notice {
	n := Notice{ID: id, Tone: tone, Title: title, Source: source, Read: readAt != nil, At: at}
	if detail != nil {
		n.Detail = *detail
	}
	return n
}

// Add records one notification for a user and trims their history. A notification a person's own action produced is
// stored already read; one added by background work (SourceSystem) stays unread until they open the bell.
func (s *Service) Add(ctx context.Context, user uuid.UUID, tone, title, detail, source string) (Notice, error) {
	title = strings.TrimSpace(title)
	if !tones[tone] || title == "" || utf8.RuneCountInString(title) > 300 || utf8.RuneCountInString(detail) > 2000 || (source != SourceUser && source != SourceSystem) {
		return Notice{}, apperr.Validation("The notification needs a tone, a title of up to 300 characters and a detail of up to 2000.")
	}
	var d *string
	if strings.TrimSpace(detail) != "" {
		d = &detail
	}
	var readAt *time.Time
	if source == SourceUser {
		t := s.now()
		readAt = &t
	}
	q := sqlcgen.New(s.Pool)
	row, err := q.InsertNotification(ctx, sqlcgen.InsertNotificationParams{UserID: user, Tone: tone, Title: title, Detail: d, Source: source, ReadAt: readAt})
	if err != nil {
		return Notice{}, err
	}
	if err := q.TrimNotifications(ctx, sqlcgen.TrimNotificationsParams{UserID: user, CreatedAt: s.now().Add(-MaxAge), Offset: MaxEntries}); err != nil {
		return Notice{}, err
	}
	return fromRow(row.ID, row.Tone, row.Title, row.Detail, row.Source, row.ReadAt, row.CreatedAt), nil
}

// List returns a user's newest notifications and how many of all of theirs are unread.
func (s *Service) List(ctx context.Context, user uuid.UUID, limit int) ([]Notice, int, error) {
	if limit < 1 || limit > MaxEntries {
		limit = 100
	}
	q := sqlcgen.New(s.Pool)
	rows, err := q.ListNotifications(ctx, sqlcgen.ListNotificationsParams{UserID: user, Limit: int32(limit)})
	if err != nil {
		return nil, 0, err
	}
	unread, err := q.CountUnreadNotifications(ctx, user)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Notice, 0, len(rows))
	for _, r := range rows {
		out = append(out, fromRow(r.ID, r.Tone, r.Title, r.Detail, r.Source, r.ReadAt, r.CreatedAt))
	}
	return out, int(unread), nil
}

func (s *Service) MarkAllRead(ctx context.Context, user uuid.UUID) error {
	return sqlcgen.New(s.Pool).MarkNotificationsRead(ctx, user)
}

func (s *Service) Clear(ctx context.Context, user uuid.UUID) error {
	return sqlcgen.New(s.Pool).ClearNotifications(ctx, user)
}
