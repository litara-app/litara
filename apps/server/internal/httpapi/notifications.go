package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/notices"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func noticeOut(n notices.Notice) wire.Notification {
	return wire.Notification{ID: n.ID.String(), Tone: n.Tone, Title: n.Title, Detail: n.Detail, Source: n.Source, Read: n.Read, CreatedAt: n.At.UTC().Format(time.RFC3339)}
}

// registerNotifications mounts the caller's own notification history (ADR-0089). Every route acts only on the
// signed-in account's entries.
func (a *API) registerNotifications(api huma.API) {
	huma.Register(api, readOp(op("listNotifications", http.MethodGet, "/notifications", "The caller's newest notifications", "notifications")),
		func(ctx context.Context, in *struct {
			Limit int `query:"limit" minimum:"1" maximum:"500" default:"100"`
		}) (*bodyOut[wire.Notifications], error) {
			items, unread, err := a.Notices.List(ctx, principal(ctx).UserID, in.Limit)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			out := wire.Notifications{Items: make([]wire.Notification, 0, len(items)), Unread: unread}
			for _, n := range items {
				out.Items = append(out.Items, noticeOut(n))
			}
			return &bodyOut[wire.Notifications]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("addNotification", http.MethodPost, "/notifications", "Record the result of the caller's own action", "notifications")),
		func(ctx context.Context, in *struct{ Body wire.NotificationWrite }) (*bodyOut[wire.Notification], error) {
			n, err := a.Notices.Add(ctx, principal(ctx).UserID, in.Body.Tone, in.Body.Title, in.Body.Detail, notices.SourceUser)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Notification]{Body: noticeOut(n)}, nil
		})

	mark := writeOp(op("markNotificationsRead", http.MethodPost, "/notifications/read", "Mark all of the caller's notifications read", "notifications"))
	mark.DefaultStatus = http.StatusNoContent
	huma.Register(api, mark, func(ctx context.Context, _ *struct{}) (*noContent, error) {
		if err := a.Notices.MarkAllRead(ctx, principal(ctx).UserID); err != nil {
			return nil, a.fail(ctx, err)
		}
		return nil, nil
	})

	clr := writeOp(op("clearNotifications", http.MethodDelete, "/notifications", "Delete all of the caller's notifications", "notifications"))
	clr.DefaultStatus = http.StatusNoContent
	huma.Register(api, clr, func(ctx context.Context, _ *struct{}) (*noContent, error) {
		if err := a.Notices.Clear(ctx, principal(ctx).UserID); err != nil {
			return nil, a.fail(ctx, err)
		}
		return nil, nil
	})
}
