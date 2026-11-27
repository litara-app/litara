package httpapi_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ADR-0094: a highlight, or a note on selected text, can be saved with one of five colour names.
func TestAnnotationColor(t *testing.T) {
	r := newReadingEnv(t)
	v := r.ed.File.ContentVersion

	with := func(color, kind, base string, sel map[string]any) map[string]any {
		body := r.annBody(uuid.NewString(), base, v, kind, "my thought", sel)
		if color != "" {
			body["data"].(map[string]any)["color"] = color
		}
		return body
	}
	read := func(id string) wire.Annotation {
		var a wire.Annotation
		r.e.Do("GET", "/editions/"+r.ed.ID+"/annotations/"+id, r.userA, nil).JSON(t, &a)
		return a
	}

	// Every name is stored and returned, on a highlight and on a note with selected text.
	for _, color := range []string{"yellow", "green", "blue", "pink", "orange"} {
		for _, kind := range []string{"highlight", "note"} {
			id := uuid.NewString()
			if x := r.putAnn(r.userA, id, with(color, kind, "0", rangeSel)); x.StatusCode != 200 {
				t.Fatalf("%s %s: %d %s", color, kind, x.StatusCode, x.Body)
			}
			if got := read(id); got.Data.Value == nil || got.Data.Value.Color != color {
				t.Fatalf("%s %s stored as %+v", color, kind, got.Data.Value)
			}
		}
	}

	// Absent stays absent: no field in the answer.
	plain := uuid.NewString()
	x := r.putAnn(r.userA, plain, with("", "highlight", "0", rangeSel))
	if x.StatusCode != 200 || strings.Contains(string(x.Body), `"color"`) {
		t.Fatalf("absent colour: %d %s", x.StatusCode, x.Body)
	}

	for name, body := range map[string]map[string]any{
		"unknown name":               with("purple", "highlight", "0", rangeSel),
		"hex value":                  with("#facc15", "highlight", "0", rangeSel),
		"bookmark":                   with("blue", "bookmark", "0", nil),
		"note without selected text": with("blue", "note", "0", nil),
	} {
		if y := r.putAnn(r.userA, uuid.NewString(), body); y.StatusCode != 422 {
			t.Fatalf("%s: %d %s", name, y.StatusCode, y.Body)
		}
	}

	// A colour changes like any other edit; a stale one is kept as a conflict, colour included.
	if y := r.putAnn(r.userA, plain, with("green", "highlight", "1", rangeSel)); y.StatusCode != 200 {
		t.Fatalf("recolour: %d %s", y.StatusCode, y.Body)
	}
	stale := r.putAnn(r.userA, plain, with("pink", "highlight", "1", rangeSel))
	if stale.StatusCode != 409 || read(plain).Data.Value.Color != "green" {
		t.Fatalf("stale recolour: %d %s", stale.StatusCode, stale.Body)
	}
	conflict := problemMap(t, stale)["conflictId"].(string)
	if y := r.e.Do("POST", "/personal-conflicts/"+conflict+"/resolve", r.userA,
		map[string]any{"operationId": uuid.NewString(), "baseRevision": "2", "choice": "use_candidate", "contentVersion": v}); y.StatusCode != 200 {
		t.Fatalf("resolve: %d %s", y.StatusCode, y.Body)
	}
	if got := read(plain); got.Data.Value.Color != "pink" {
		t.Fatalf("resolved colour: %+v", got.Data.Value)
	}

	// A write without the field resets to the default look, as ADR-0094 accepts for older clients.
	if y := r.putAnn(r.userA, plain, with("", "highlight", "3", rangeSel)); y.StatusCode != 200 || read(plain).Data.Value.Color != "" {
		t.Fatalf("reset: %d %s", y.StatusCode, y.Body)
	}

	// The cross-book list carries it too.
	hub := r.e.Do("GET", "/annotations?size=200", r.userA, nil)
	if hub.StatusCode != 200 || !strings.Contains(string(hub.Body), `"color":"orange"`) {
		t.Fatalf("hub: %d %s", hub.StatusCode, hub.Body)
	}
}
