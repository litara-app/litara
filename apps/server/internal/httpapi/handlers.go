package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/accounts"
	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type bodyOut[T any] struct {
	Body T
}

type noContent struct{}

type PageQuery = pageQuery

func mustUUID(s string) uuid.UUID {
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil
	}
	return id
}

// ---- discovery ------------------------------------------------------------

func (a *API) registerDiscovery(api huma.API) {
	huma.Register(api, publicOp(op("discover", http.MethodGet, "/discovery", "Discover this server", "discovery")),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.Discovery], error) {
			id, err := a.Accounts.ServerID(ctx)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Discovery]{Body: wire.Discovery{ServerID: id.String(), Product: "Litara", APIVersions: []string{"v1"},
				APIBasePath: a.base, Stability: "development", Registration: "admin-only",
				Capabilities: []string{"recordings", "range-media", "position-conflicts", "offline-snapshots"}}}, nil
		})
}

// ---- auth -----------------------------------------------------------------

type loginIn struct {
	Body wire.Login
}

type webLoginOut struct {
	SetCookie http.Cookie `header:"Set-Cookie"`
	Body      wire.BrowserSession
}

type clearCookieOut struct {
	SetCookie http.Cookie `header:"Set-Cookie"`
}

func (a *API) sessionCookie(value string, expires time.Time, clear bool) http.Cookie {
	c := http.Cookie{Name: CookieName, Value: value, Path: a.base, HttpOnly: true, Secure: !a.Config.DevInsecureHTTP,
		SameSite: http.SameSiteLaxMode}
	if clear {
		c.MaxAge = -1
		c.Expires = time.Unix(0, 0)
	} else {
		c.Expires = expires
		c.MaxAge = int(time.Until(expires).Seconds())
	}
	return c
}

func (a *API) registerAuth(api huma.API) {
	huma.Register(api, publicOp(op("nativeLogin", http.MethodPost, "/auth/native/login", "Sign in from a native client", "auth")),
		func(ctx context.Context, in *loginIn) (*bodyOut[wire.TokenPair], error) {
			tp, err := a.Accounts.LoginNative(ctx, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.TokenPair]{Body: tp}, nil
		})

	huma.Register(api, publicOp(op("nativeRefresh", http.MethodPost, "/auth/native/refresh", "Rotate native credentials", "auth")),
		func(ctx context.Context, in *struct{ Body wire.Refresh }) (*bodyOut[wire.TokenPair], error) {
			raw, err := a.Accounts.Refresh(ctx, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			var tp wire.TokenPair
			if err := json.Unmarshal(raw, &tp); err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.TokenPair]{Body: tp}, nil
		})

	o := op("nativeLogout", http.MethodPost, "/auth/native/logout", "Revoke the current native session", "auth")
	o.Security, o.DefaultStatus = []map[string][]string{{"bearer": {}}}, http.StatusNoContent
	huma.Register(api, o, func(ctx context.Context, _ *struct{}) (*noContent, error) {
		if err := a.Accounts.Logout(ctx, principal(ctx)); err != nil {
			return nil, a.fail(ctx, err)
		}
		return nil, nil
	})

	huma.Register(api, publicOp(op("webLogin", http.MethodPost, "/auth/web/login", "Sign in from a browser", "auth")),
		func(ctx context.Context, in *loginIn) (*webLoginOut, error) {
			tok, exp, bs, err := a.Accounts.LoginWeb(ctx, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &webLoginOut{SetCookie: a.sessionCookie(tok, exp, false), Body: bs}, nil
		})

	ws := op("webSession", http.MethodGet, "/auth/web/session", "Current browser session and CSRF token", "auth")
	ws.Security = []map[string][]string{{"browserSession": {}}}
	huma.Register(api, ws, func(ctx context.Context, _ *struct{}) (*bodyOut[wire.BrowserSession], error) {
		p := principal(ctx)
		if p.Kind != "web" {
			return nil, a.fail(ctx, apperr.ErrUnauthenticated)
		}
		bs, err := a.Accounts.CurrentSession(ctx, p)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.BrowserSession]{Body: bs}, nil
	})

	wl := op("webLogout", http.MethodPost, "/auth/web/logout", "End the browser session", "auth")
	wl.Security, wl.DefaultStatus = []map[string][]string{{"browserSession": {}, "csrf": {}}}, http.StatusNoContent
	huma.Register(api, wl, func(ctx context.Context, _ *struct{}) (*clearCookieOut, error) {
		p := principal(ctx)
		if p.Kind != "web" {
			return nil, a.fail(ctx, apperr.ErrUnauthenticated)
		}
		if err := a.Accounts.Logout(ctx, p); err != nil {
			return nil, a.fail(ctx, err)
		}
		return &clearCookieOut{SetCookie: a.sessionCookie("", time.Time{}, true)}, nil
	})

	huma.Register(api, op("currentUser", http.MethodGet, "/me", "The current account", "auth"),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.User], error) {
			u, err := a.Accounts.User(ctx, principal(ctx).UserID)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.User]{Body: u}, nil
		})

	huma.Register(api, op("listSessions", http.MethodGet, "/sessions", "The caller's own device sessions", "auth"),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.Sessions], error) {
			s, err := a.Accounts.Sessions(ctx, principal(ctx).UserID)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Sessions]{Body: s}, nil
		})

	rs := op("revokeSession", http.MethodDelete, "/sessions/{sessionId}", "Revoke one of the caller's own sessions", "auth")
	rs.Security, rs.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, rs, func(ctx context.Context, in *struct {
		SessionID string `path:"sessionId" format:"uuid"`
	}) (*noContent, error) {
		if err := a.Accounts.RevokeOwn(ctx, principal(ctx).UserID, mustUUID(in.SessionID)); err != nil {
			return nil, a.fail(ctx, err)
		}
		return nil, nil
	})
}

// ---- administration -------------------------------------------------------

func (a *API) registerAdmin(api huma.API) {
	huma.Register(api, adminOp(op("listUsers", http.MethodGet, "/admin/users", "List accounts", "admin")),
		func(ctx context.Context, in *struct{ PageQuery }) (*bodyOut[wire.UserList], error) {
			page, size := in.normalized()
			l, err := a.Accounts.ListUsers(ctx, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.UserList]{Body: l}, nil
		})

	cu := adminOp(op("createUser", http.MethodPost, "/admin/users", "Create an account (no implicit library grant)", "admin"))
	cu.Security, cu.DefaultStatus = secured, http.StatusCreated
	huma.Register(api, cu, func(ctx context.Context, in *struct{ Body wire.CreateUser }) (*bodyOut[wire.User], error) {
		u, err := a.Accounts.CreateUser(ctx, in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.User]{Body: u}, nil
	})

	uu := adminOp(op("updateUser", http.MethodPatch, "/admin/users/{userId}", "Change display name, admin or active state", "admin"))
	uu.Security = secured
	huma.Register(api, uu, func(ctx context.Context, in *struct {
		UserID string `path:"userId" format:"uuid"`
		Body   wire.UpdateUser
	}) (*bodyOut[wire.User], error) {
		u, err := a.Accounts.UpdateUser(ctx, mustUUID(in.UserID), in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.User]{Body: u}, nil
	})

	type grantIn struct {
		UserID    string `path:"userId" format:"uuid"`
		LibraryID string `path:"libraryId" format:"uuid"`
	}
	gl := adminOp(op("grantLibrary", http.MethodPut, "/admin/users/{userId}/libraries/{libraryId}", "Grant a user library access", "admin"))
	gl.Security, gl.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, gl, func(ctx context.Context, in *grantIn) (*noContent, error) {
		if err := a.Accounts.Grant(ctx, mustUUID(in.UserID), mustUUID(in.LibraryID)); err != nil {
			return nil, a.fail(ctx, err)
		}
		return nil, nil
	})
	rg := adminOp(op("removeLibraryGrant", http.MethodDelete, "/admin/users/{userId}/libraries/{libraryId}", "Remove a library grant", "admin"))
	rg.Security, rg.DefaultStatus = secured, http.StatusNoContent
	huma.Register(api, rg, func(ctx context.Context, in *grantIn) (*noContent, error) {
		if err := a.Accounts.RemoveGrant(ctx, mustUUID(in.UserID), mustUUID(in.LibraryID)); err != nil {
			return nil, a.fail(ctx, err)
		}
		return nil, nil
	})
}

// ---- recordings -----------------------------------------------------------

type listRecordingsIn struct {
	PageQuery
	Q          string `query:"q" maxLength:"256"`
	LibraryID  string `query:"libraryId" format:"uuid"`
	Completion string `query:"completion" enum:"any,unfinished,finished" default:"any"`
	Sort       string `query:"sort" enum:"title,recent" default:"title"`
}

type RecordingPath struct {
	RecordingID string `path:"recordingId" format:"uuid"`
}

func (a *API) registerRecordings(api huma.API) {
	huma.Register(api, op("listLibraries", http.MethodGet, "/libraries", "Libraries the caller may read", "catalog"),
		func(ctx context.Context, in *struct{ PageQuery }) (*bodyOut[wire.LibraryList], error) {
			page, size := in.normalized()
			l, err := a.Accounts.Libraries(ctx, principal(ctx).UserID, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.LibraryList]{Body: l}, nil
		})

	huma.Register(api, op("listRecordings", http.MethodGet, "/recordings", "List and search permitted recordings", "catalog"),
		func(ctx context.Context, in *listRecordingsIn) (*bodyOut[wire.Recordings], error) {
			page, size := in.normalized()
			p := catalog.ListParams{Page: page, Size: size, Q: in.Q, Completion: in.Completion, Sort: in.Sort}
			if in.LibraryID != "" {
				id := mustUUID(in.LibraryID)
				p.LibraryID = &id
			}
			l, err := a.Catalog.List(ctx, principal(ctx).UserID, p)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Recordings]{Body: l}, nil
		})

	huma.Register(api, op("getRecordingSnapshot", http.MethodGet, "/recordings/{recordingId}", "Self-contained recording snapshot", "catalog"),
		func(ctx context.Context, in *RecordingPath) (*bodyOut[wire.Recording], error) {
			r, err := a.Catalog.Snapshot(ctx, principal(ctx).UserID, mustUUID(in.RecordingID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Recording]{Body: r}, nil
		})

	huma.Register(api, op("getTitleHistory", http.MethodGet, "/titles/{titleId}/history", "The caller's completion history for a title", "progress"),
		func(ctx context.Context, in *struct {
			TitleID string `path:"titleId" format:"uuid"`
			PageQuery
		}) (*bodyOut[wire.History], error) {
			page, size := in.normalized()
			h, err := a.Catalog.History(ctx, principal(ctx).UserID, mustUUID(in.TitleID), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.History]{Body: h}, nil
		})
}

// ---- progress -------------------------------------------------------------

func (a *API) registerProgress(api huma.API) {
	huma.Register(api, op("getPosition", http.MethodGet, "/recordings/{recordingId}/position", "Current position state", "progress"),
		func(ctx context.Context, in *RecordingPath) (*bodyOut[wire.PositionState], error) {
			st, err := a.Progress.GetPosition(ctx, principal(ctx).UserID, mustUUID(in.RecordingID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.PositionState]{Body: st}, nil
		})

	wp := op("writePosition", http.MethodPut, "/recordings/{recordingId}/position", "Write a revision-aware position", "progress")
	wp.Security = secured
	huma.Register(api, wp, func(ctx context.Context, in *struct {
		RecordingPath
		Body wire.PositionWrite
	}) (*bodyOut[wire.PositionState], error) {
		st, err := a.Progress.WritePosition(ctx, a.actor(ctx), mustUUID(in.RecordingID), in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.PositionState]{Body: st}, nil
	})

	rc := op("resolveConflict", http.MethodPost, "/recordings/{recordingId}/conflicts/{conflictId}/resolve", "Resolve a position conflict", "progress")
	rc.Security = secured
	huma.Register(api, rc, func(ctx context.Context, in *struct {
		RecordingPath
		ConflictID string `path:"conflictId" format:"uuid"`
		Body       wire.ResolveConflict
	}) (*bodyOut[wire.PositionState], error) {
		st, err := a.Progress.ResolveConflict(ctx, a.actor(ctx), mustUUID(in.RecordingID), mustUUID(in.ConflictID), in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.PositionState]{Body: st}, nil
	})

	huma.Register(api, op("getCompletion", http.MethodGet, "/recordings/{recordingId}/completion", "Current completion state", "progress"),
		func(ctx context.Context, in *RecordingPath) (*bodyOut[wire.CompletionState], error) {
			st, err := a.Progress.GetCompletion(ctx, principal(ctx).UserID, mustUUID(in.RecordingID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.CompletionState]{Body: st}, nil
		})

	wc := op("writeCompletion", http.MethodPut, "/recordings/{recordingId}/completion", "Write a completion event", "progress")
	wc.Security = secured
	huma.Register(api, wc, func(ctx context.Context, in *struct {
		RecordingPath
		Body wire.CompletionWrite
	}) (*bodyOut[wire.CompletionState], error) {
		st, err := a.Progress.WriteCompletion(ctx, a.actor(ctx), mustUUID(in.RecordingID), in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.CompletionState]{Body: st}, nil
	})

	rcc := op("resolveCompletionConflict", http.MethodPost, "/recordings/{recordingId}/completion-conflicts/{conflictId}/resolve", "Resolve a completion conflict", "progress")
	rcc.Security = secured
	huma.Register(api, rcc, func(ctx context.Context, in *struct {
		RecordingPath
		ConflictID string `path:"conflictId" format:"uuid"`
		Body       wire.ResolveCompletionConflict
	}) (*bodyOut[wire.CompletionState], error) {
		st, err := a.Progress.ResolveCompletionConflict(ctx, a.actor(ctx), mustUUID(in.RecordingID), mustUUID(in.ConflictID), in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.CompletionState]{Body: st}, nil
	})
}

var _ = accounts.AccessTTL
