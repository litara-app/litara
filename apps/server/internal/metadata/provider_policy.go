package metadata

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	providerLookupTimeout = 15 * time.Second
	providerQueueSize     = 16
	maxCachedResponses    = 128
	maxCachedBody         = 64 << 10
	maxCacheAge           = 15 * time.Minute
)

var errProviderBusy = errors.New("provider request budget is temporarily unavailable")

// NewProviders creates one request budget per provider, shared by all library jobs.
func NewProviders(openLibraryContact, googleBooksKey string) map[string]Provider {
	client := &http.Client{
		Timeout: providerLookupTimeout,
		// Keep the contact, credentials and quota accounting on the configured endpoint.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	openLibrary := newProviderHTTP(client, "https://openlibrary.org", 1, true)
	if openLibraryContact != "" {
		openLibrary.userAgent = "Litara (" + openLibraryContact + ")"
		openLibrary.policy.interval = (time.Second + 2) / 3
	}
	return map[string]Provider{
		ProviderOpenLibrary: OpenLibrary{HTTP: openLibrary},
		ProviderGoogleBooks: GoogleBooks{HTTP: newProviderHTTP(client, "https://www.googleapis.com", 1, false), APIKey: googleBooksKey},
		ProviderAudnexus:    Audnexus{HTTP: newProviderHTTP(client, "https://api.audnex.us", 1, false)},
	}
}

type cachedResponse struct {
	body    []byte
	expires time.Time
}

type providerPolicy struct {
	slots    chan struct{}
	turn     chan struct{}
	interval time.Duration
	next     time.Time // protected by turn

	cacheMu sync.Mutex
	cache   map[string]cachedResponse // nil when response caching is disabled
}

func newProviderHTTP(client *http.Client, base string, perSecond int, cache bool) HTTP {
	p := &providerPolicy{
		slots: make(chan struct{}, providerQueueSize), turn: make(chan struct{}, 1),
		interval: time.Second / time.Duration(perSecond),
	}
	if cache {
		p.cache = make(map[string]cachedResponse)
	}
	return HTTP{Client: client, BaseURL: base, policy: p}
}

func (p *providerPolicy) enter(ctx context.Context) error {
	select {
	case p.slots <- struct{}{}:
	default:
		return errProviderBusy
	}
	select {
	case p.turn <- struct{}{}:
		return nil
	case <-ctx.Done():
		<-p.slots
		return ctx.Err()
	}
}

func (p *providerPolicy) leave() {
	<-p.turn
	<-p.slots
}

func (p *providerPolicy) wait(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok && !p.next.Before(deadline) {
		return errProviderBusy
	}
	if delay := time.Until(p.next); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	p.next = time.Now().Add(p.interval)
	return nil
}

func retryDelay(value string, now time.Time) time.Duration {
	const maxSeconds = uint64((1<<63 - 1) / time.Second)
	if n, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64); err == nil {
		return max(time.Second, time.Duration(min(n, maxSeconds))*time.Second)
	} else if errors.Is(err, strconv.ErrRange) {
		return time.Duration(maxSeconds) * time.Second
	}
	if t, err := http.ParseTime(value); err == nil {
		return max(time.Second, t.Sub(now))
	}
	return time.Second
}

func (p *providerPolicy) getCached(key string) []byte {
	p.cacheMu.Lock()
	defer p.cacheMu.Unlock()
	v, ok := p.cache[key]
	if ok && !time.Now().Before(v.expires) {
		delete(p.cache, key)
		return nil
	}
	return v.body
}

func (p *providerPolicy) cacheResponse(key string, body []byte, headers http.Header) {
	if p.cache == nil || len(key) > 4096 || len(body) > maxCachedBody || headers.Get("Vary") == "*" {
		return
	}
	if strings.EqualFold(strings.TrimSpace(headers.Get("Pragma")), "no-cache") {
		return
	}
	ttl := maxCacheAge
	for _, line := range headers.Values("Cache-Control") {
		for _, d := range strings.Split(line, ",") {
			name, value, _ := strings.Cut(strings.TrimSpace(d), "=")
			switch strings.ToLower(name) {
			case "no-store", "no-cache", "private":
				return
			case "max-age":
				if seconds, err := strconv.ParseUint(strings.Trim(value, "\" "), 10, 64); err == nil {
					ttl = min(ttl, time.Duration(min(seconds, uint64(maxCacheAge/time.Second)))*time.Second)
				}
			}
		}
	}
	if age, err := strconv.ParseUint(headers.Get("Age"), 10, 64); err == nil {
		ttl -= time.Duration(min(age, uint64(maxCacheAge/time.Second))) * time.Second
	}
	now := time.Now()
	if expires, err := http.ParseTime(headers.Get("Expires")); err == nil {
		ttl = min(ttl, expires.Sub(now))
	}
	if ttl <= 0 {
		return
	}
	p.cacheMu.Lock()
	defer p.cacheMu.Unlock()
	if len(p.cache) >= maxCachedResponses {
		var oldestKey string
		var oldest time.Time
		for k, response := range p.cache {
			if oldest.IsZero() || response.expires.Before(oldest) {
				oldestKey, oldest = k, response.expires
			}
		}
		delete(p.cache, oldestKey)
	}
	p.cache[key] = cachedResponse{body: body, expires: now.Add(ttl)}
}
