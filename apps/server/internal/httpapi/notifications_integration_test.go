package httpapi_test

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/notices"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func TestNotificationsAreStoredPerAccountWithUnreadStateAndRetention(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	list := func(token string, limit int) wire.Notifications {
		var out wire.Notifications
		x := e.Do("GET", "/notifications?limit="+strconv.Itoa(limit), token, nil)
		if x.StatusCode != http.StatusOK {
			t.Fatalf("list: %d %s", x.StatusCode, x.Body)
		}
		x.JSON(t, &out)
		return out
	}

	// A person's own action is stored already read.
	x := e.Do("POST", "/notifications", r.userA, map[string]any{"tone": "success", "title": "Saved", "detail": "Title"})
	var made wire.Notification
	x.JSON(t, &made)
	if x.StatusCode != http.StatusOK || made.Source != "user" || !made.Read || made.Title != "Saved" || made.Detail != "Title" {
		t.Fatalf("add: %d %s", x.StatusCode, x.Body)
	}
	if got := list(r.userA, 100); len(got.Items) != 1 || got.Unread != 0 {
		t.Fatalf("own action: %+v", got)
	}
	// Accounts never see each other's entries.
	if got := list(r.userB, 100); len(got.Items) != 0 || got.Unread != 0 {
		t.Fatalf("another account sees entries: %+v", got)
	}

	// Background work stays unread until the account marks them read; the API cannot create them.
	if _, err := notices.New(e.Pool).Add(context.Background(), e.Fix.UserAID, "info", "Scan finished", "3 books", notices.SourceSystem); err != nil {
		t.Fatal(err)
	}
	got := list(r.userA, 100)
	if len(got.Items) != 2 || got.Unread != 1 || got.Items[0].Title != "Scan finished" || got.Items[0].Source != "system" || got.Items[0].Read {
		t.Fatalf("background entry: %+v", got)
	}
	if bad := e.Do("POST", "/notifications", r.userA, map[string]any{"tone": "info", "title": "x", "source": "system"}); bad.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("a client must not be able to create a background notification: %d %s", bad.StatusCode, bad.Body)
	}
	if mark := e.Do("POST", "/notifications/read", r.userA, nil); mark.StatusCode != http.StatusNoContent {
		t.Fatalf("mark read: %d %s", mark.StatusCode, mark.Body)
	}
	if got := list(r.userA, 100); got.Unread != 0 {
		t.Fatalf("after mark read: %+v", got)
	}

	// Validation.
	for name, body := range map[string]map[string]any{
		"unknown tone": {"tone": "loud", "title": "x"},
		"empty title":  {"tone": "info", "title": ""},
	} {
		if y := e.Do("POST", "/notifications", r.userA, body); y.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %d %s", name, y.StatusCode, y.Body)
		}
	}

	// Retention: only the newest 500 are kept.
	svc := notices.New(e.Pool)
	for i := 0; i < notices.MaxEntries+5; i++ {
		if _, err := svc.Add(context.Background(), e.Fix.UserAID, "info", "bulk "+strconv.Itoa(i), "", notices.SourceUser); err != nil {
			t.Fatal(err)
		}
	}
	all := list(r.userA, 500)
	if len(all.Items) != notices.MaxEntries || all.Items[0].Title != "bulk "+strconv.Itoa(notices.MaxEntries+4) {
		t.Fatalf("retention: %d entries, newest %q", len(all.Items), all.Items[0].Title)
	}

	// Clearing removes only the caller's own history.
	e.Do("POST", "/notifications", r.userB, map[string]any{"tone": "info", "title": "B's"})
	if c := e.Do("DELETE", "/notifications", r.userA, nil); c.StatusCode != http.StatusNoContent {
		t.Fatalf("clear: %d %s", c.StatusCode, c.Body)
	}
	if a, b := list(r.userA, 100), list(r.userB, 100); len(a.Items) != 0 || len(b.Items) != 1 {
		t.Fatalf("after clear: a=%d b=%d", len(a.Items), len(b.Items))
	}
}
