import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PendingOp } from "./store";
import { PendingPage } from "./PendingPage";

const api = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ revision: "9", finished: false, changedAt: null }));
const get = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ revision: "7", finished: true, changedAt: "2026-11-20T10:00:00Z" }));
vi.mock("../api/client", async (orig) => ({ ...(await orig<object>()), api: (...a: unknown[]) => api(...a), get: (...a: unknown[]) => get(...a) }));

let items: PendingOp[] = [];
const discard = vi.fn(async () => undefined);
vi.mock("./PendingProvider", () => ({
  usePendingState: () => ({ items, durable: true, offline: false }),
  usePendingQueue: () => ({ forKey: (k: string) => items.filter((o) => o.resourceKey === k), discard, retry: vi.fn() }),
}));

// An offline "mark unfinished" that reached the server after another device had marked the recording finished.
const conflict = {
  id: "op1", kind: "recording-completion", resourceKey: "rcomp:R1", editionId: "R1", method: "PUT", path: "/recordings/R1/completion",
  label: "Mark unfinished", status: "conflict", attempts: 1, createdAt: "2026-11-21T09:00:00Z",
  body: { operationId: "x", baseRevision: "5", layoutRevision: "6f1c2d1e-0000-4000-8000-000000000001", event: "manual_unfinish", capturedAt: "2026-11-21T08:59:00Z", finalPosition: null },
  problem: { code: "completion_conflict", conflictId: "c1", currentCompletion: { revision: "6", finished: true, changedAt: "2026-11-20T10:00:00Z" } },
} as unknown as PendingOp;

beforeEach(() => { items = [conflict]; api.mockClear(); get.mockClear(); discard.mockClear(); });
afterEach(cleanup);

// ADR-0034: an audiobook completion conflict is shown with both states and settled by an explicit choice, not only discarded.
test.each([["Keep what is saved", "keep_server"], ["Use my change", "use_candidate"]])(
  "an audio completion conflict shows both states and %s resolves it against the current revision", async (label, choice) => {
    render(<PendingPage />);
    const item = screen.getByTestId("pending-item");
    const ctx = within(item).getByTestId("completion-choice");
    expect(ctx.textContent).toMatch(/Saved: Finished/);
    expect(ctx.textContent).toMatch(/Your change: Not finished/);
    fireEvent.click(within(item).getByRole("button", { name: label }));
    await waitFor(() => expect(discard).toHaveBeenCalledWith("op1"));
    expect(get).toHaveBeenCalledWith("/recordings/R1/completion"); // the server's revision now, not the one in the conflict
    expect(api).toHaveBeenCalledWith("POST", "/recordings/R1/completion-conflicts/c1/resolve", {
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), baseRevision: "7", layoutRevision: "6f1c2d1e-0000-4000-8000-000000000001", choice,
      event: null, capturedAt: expect.any(String), finalPosition: null,
    });
  });

test("a failed resolution keeps the change and says why", async () => {
  api.mockRejectedValueOnce(new Error("conflict_resolved"));
  render(<PendingPage />);
  fireEvent.click(screen.getByRole("button", { name: "Keep what is saved" }));
  expect(await screen.findByText(/conflict_resolved/)).toBeTruthy();
  expect(discard).not.toHaveBeenCalled();
});
