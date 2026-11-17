package httpapi_test

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/smtptest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Retained KOReader state is private to the library grant: after a revoke the conflict is not listed or settled.
func TestKOReaderManagementRequiresLibraryGrant(t *testing.T) {
	k := newKOEnv(t)
	doc := k.docs["vol2"]
	A, B := k.credA1, k.credA2
	k.get(doc, A, k.pwA1)
	k.do("PUT", "/1/syncs/progress", A, k.pwA1, koPut(doc, "a1", 0.2, "A"))
	k.get(doc, B, k.pwA2)
	k.do("PUT", "/1/syncs/progress", B, k.pwA2, koPut(doc, "b-cand", 0.7, "B"))
	c := k.conflicts(t)[0]
	if r := k.e.Do("PUT", "/koreader/bindings/"+uuid.NewString(), k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0",
		"credentialId": A.ID, "fileId": k.editions["vol2"].File.ID, "contentVersion": k.editions["vol2"].File.ContentVersion, "document": doc}); r.StatusCode != 200 {
		t.Fatalf("bind: %d %s", r.StatusCode, r.Body)
	}
	var bl wire.T006DigestBindingList
	k.e.Do("GET", "/koreader/bindings", k.userA, nil).JSON(t, &bl)
	if len(bl.Items) != 1 {
		t.Fatalf("bindings before revoke: %+v", bl)
	}

	if r := k.e.Do("DELETE", "/admin/users/"+k.e.Fix.UserAID.String()+"/libraries/"+k.lib, k.admin, nil); r.StatusCode != 204 {
		t.Fatalf("revoke: %d", r.StatusCode)
	}
	var cl wire.T006KoConflictList
	k.e.Do("GET", "/koreader/conflicts", k.userA, nil).JSON(t, &cl)
	if len(cl.Items) != 0 || cl.Total != 0 {
		t.Fatalf("a revoked library's candidate is still listed: %+v", cl)
	}
	k.e.Do("GET", "/koreader/bindings", k.userA, nil).JSON(t, &bl)
	if len(bl.Items) != 0 || bl.Total != 0 {
		t.Fatalf("a revoked library's binding is still listed: %+v", bl)
	}
	for _, action := range []string{"keep_server", "use_candidate"} {
		body := map[string]any{"operationId": uuid.NewString(), "baseRevision": c.CurrentRevision, "action": action}
		if r := k.e.Do("POST", "/koreader/conflicts/"+c.ID+"/resolve", k.userA, body); r.StatusCode != 403 {
			t.Fatalf("%s after revoke: %d %s", action, r.StatusCode, r.Body)
		}
	}
	var bid string
	_ = k.e.Pool.QueryRow(t.Context(), "SELECT id::text FROM koreader_bindings WHERE credential_id = $1", A.ID).Scan(&bid)
	if r := k.e.Do("DELETE", "/koreader/bindings/"+bid, k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "1"}); r.StatusCode != 403 {
		t.Fatalf("binding delete after revoke: %d %s", r.StatusCode, r.Body)
	}
}

// A PUT without a percentage is invalid; it must not be saved as 0% nor retained as a candidate.
func TestKOReaderPutRequiresPercentage(t *testing.T) {
	k := newKOEnv(t)
	doc := k.docs["vol2"]
	k.get(doc, k.credA1, k.pwA1)
	for name, body := range map[string]map[string]any{
		"missing": {"document": doc, "progress": "p", "device": "D"},
		"null":    {"document": doc, "progress": "p", "percentage": nil, "device": "D"},
	} {
		r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, body)
		if r.StatusCode != 400 || koCode(r) != 2003 {
			t.Fatalf("%s percentage: %d %s", name, r.StatusCode, r.Body)
		}
	}
	if p := k.position(t, k.editions["vol2"].ID); p.Revision != "0" || len(k.conflicts(t)) != 0 {
		t.Fatalf("an invalid PUT changed state: %+v", p)
	}
	if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, koPut(doc, "p", 0, "D")); r.StatusCode != 200 {
		t.Fatalf("an explicit 0 is valid: %d %s", r.StatusCode, r.Body)
	}
}

// Identical requests that race on one operation ID all succeed with the one original result.
func TestIdenticalConcurrentOperationsReplay(t *testing.T) {
	d := newDelEnv(t)
	id, op := uuid.NewString(), uuid.NewString()
	body := map[string]any{"operationId": op, "baseRevision": "0", "data": map[string]any{"name": "Racer", "address": "racer@example.test"}}
	codes := make([]int, 8)
	bodies := make([]string, 8)
	var wg sync.WaitGroup
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := d.e.Do("PUT", "/delivery/recipients/"+id, d.userA, body)
			codes[i], bodies[i] = r.StatusCode, string(r.Body)
		}(i)
	}
	wg.Wait()
	for i := range codes {
		if codes[i] != 200 || bodies[i] != bodies[0] {
			t.Fatalf("racing identical requests: %v %q", codes, bodies)
		}
	}
	// A different payload on the same operation is still refused.
	body["data"] = map[string]any{"name": "Other", "address": "other@example.test"}
	if r := d.e.Do("PUT", "/delivery/recipients/"+id, d.userA, body); r.StatusCode != 409 || r.Code() != "operation_id_reused" {
		t.Fatalf("changed payload: %d %s", r.StatusCode, r.Body)
	}
}

// A delivery whose queue job was lost is driven by the ledger sweep: due work resumes, an interrupted attempt settles.
func TestDeliveryRecoverySweep(t *testing.T) {
	d := newDelEnv(t)
	sink := smtptest.Start(t, smtptest.StartTLS, d.e.CA, smtptest.Behavior{})
	d.putServer(t, sink, "starttls")
	queued := d.send(t, d.ebook) // its job is never run: as if the queue discarded it
	stuck := d.send(t, d.cbz)
	if _, err := d.e.Pool.Exec(t.Context(), "UPDATE deliveries SET state = 'sending', attempts = 1, attempt_open = true, lease_until = $2 WHERE id = $1",
		stuck.ID, d.e.Clock.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	d.e.Clock.Advance(10 * time.Second)
	if n, err := d.e.Delivery.Recover(t.Context(), 10); err != nil || n != 0 {
		t.Fatalf("nothing is overdue yet: n=%d err=%v", n, err)
	}
	d.e.Clock.Advance(5 * time.Minute)
	if n, err := d.e.Delivery.Recover(t.Context(), 10); err != nil || n != 2 {
		t.Fatalf("recover: n=%d err=%v", n, err)
	}
	if got := d.delivery(t, queued.ID); got.State != "accepted" {
		t.Fatalf("overdue queued delivery: %+v", got)
	}
	got := d.delivery(t, stuck.ID)
	if got.State != "outcome_unknown" || got.Code == nil || *got.Code != "attempt_interrupted" || len(sink.Received()) != 1 {
		t.Fatalf("interrupted attempt: %+v messages=%d", got, len(sink.Received()))
	}
	if n, _ := d.e.Delivery.Recover(t.Context(), 10); n != 0 {
		t.Fatalf("settled deliveries must not be picked up again: %d", n)
	}
}
