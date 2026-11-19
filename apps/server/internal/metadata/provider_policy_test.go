package metadata

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestProviderIdentificationAndBudgets(t *testing.T) {
	const contact = "books-ops@example.org"
	anonymous := NewProviders("", "")
	if h := anonymous[ProviderOpenLibrary].(OpenLibrary).HTTP; h.userAgent != "" || h.policy.interval != time.Second {
		t.Fatal("anonymous requests must use the unidentified budget")
	}
	configured := NewProviders(contact, "")
	h := configured[ProviderOpenLibrary].(OpenLibrary).HTTP
	if h.policy.interval*3 < time.Second || h.policy.interval >= time.Second {
		t.Fatalf("invalid identified interval %v", h.policy.interval)
	}
	if g := configured[ProviderGoogleBooks].(GoogleBooks).HTTP; g.userAgent != "" || g.policy == h.policy || g.policy.cache != nil {
		t.Fatal("Google Books must have an independent budget and no Open Library contact or cache")
	}
	if a := configured[ProviderAudnexus].(Audnexus).HTTP; a.userAgent != "" || a.policy == h.policy || a.policy.cache != nil {
		t.Fatal("Audnexus must have an independent budget and no Open Library contact or cache")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.UserAgent(); got != "Litara ("+contact+")" {
			t.Errorf("Open Library User-Agent = %q", got)
		}
		fmt.Fprint(w, `{"docs":[]}`)
	}))
	defer srv.Close()
	h.BaseURL = srv.URL
	if _, err := (OpenLibrary{HTTP: h}).Lookup(t.Context(), Query{Title: "fixture"}); err != nil {
		t.Fatal(err)
	}
}

func TestProviderAdmissionAndCacheAcrossConcurrentLookups(t *testing.T) {
	var mu sync.Mutex
	var starts []time.Time
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		starts = append(starts, time.Now())
		mu.Unlock()
		if r.URL.Query().Get("title") == "no store" {
			w.Header().Set("Cache-Control", "no-store")
		}
		fmt.Fprint(w, `{"docs":[]}`)
	}))
	defer srv.Close()
	p := OpenLibrary{HTTP: newProviderHTTP(srv.Client(), srv.URL, 1, true)}
	p.policy.interval = 40 * time.Millisecond
	var wg sync.WaitGroup
	for _, title := range []string{"one", "two", "one", "two", "no store", "no store"} {
		wg.Go(func() {
			if _, err := p.Lookup(t.Context(), Query{Title: title}); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	mu.Lock()
	defer mu.Unlock()
	if len(starts) != 4 {
		t.Fatalf("sent %d requests, want two cached and two uncacheable requests", len(starts))
	}
	for i := 1; i < len(starts); i++ {
		if starts[i].Sub(starts[i-1]) < 25*time.Millisecond {
			t.Fatalf("requests admitted too close together: %v", starts)
		}
	}
}

func TestProviderRetryAfter(t *testing.T) {
	now := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	if got := retryDelay(now.Add(3*time.Second).Format(http.TimeFormat), now); got != 3*time.Second {
		t.Fatalf("HTTP date delay %v", got)
	}
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(429)
	}))
	defer srv.Close()
	p := OpenLibrary{HTTP: newProviderHTTP(srv.Client(), srv.URL, 1, true)}
	p.policy.interval = time.Millisecond
	start := time.Now()
	if _, err := p.Lookup(t.Context(), Query{Title: "retry"}); err == nil || calls.Load() != 2 || time.Since(start) < time.Second {
		t.Fatalf("expected one delayed retry, calls=%d, err=%v", calls.Load(), err)
	}
	if _, err := p.Lookup(t.Context(), Query{Title: "other work"}); err != errProviderBusy || calls.Load() != 2 {
		t.Fatalf("expected shared cooldown without another request, calls=%d, err=%v", calls.Load(), err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := p.Lookup(ctx, Query{Title: "canceled"}); err != context.Canceled {
		t.Fatalf("expected cancellation, got %v", err)
	}
}
