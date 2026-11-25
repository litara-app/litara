import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { Edition, MetadataField } from "../../api/types";
import { MetadataTab } from "./MetadataTab";

const handler = vi.fn(async (_method: string, _path: string, _body?: unknown): Promise<unknown> => undefined);
vi.mock("../../api/client", async (orig) => ({
  ...(await orig<object>()),
  api: (m: string, p: string, b?: unknown) => handler(m, p, b),
  get: (p: string) => handler("GET", p),
}));
afterEach(() => { cleanup(); handler.mockReset(); });

const saves = () => handler.mock.calls.filter((c) => c[0] === "PATCH")
  .map((c) => { const b = c[2] as { baseRevision: string; changes: { field: string; action: string }[] }; return { fields: b.changes.map((x) => `${x.field}:${x.action}`), base: b.baseRevision }; });

/** A stand-in server holding one edition revision; a write based on any other revision is refused. */
function server() {
  const state = { revision: 4, fields: [{ field: "language", source: "embedded", cleared: false, value: "en", locked: false, conflicts: [] }] as MetadataField[] };
  handler.mockImplementation(async (method, path, body) => {
    if (method === "GET") return { editionId: "E1", revision: String(state.revision), fields: state.fields };
    if (path.endsWith("/auto-fill")) return { outcome: "proposed", provider: "open_library", rule: "identifier", filled: [], revision: String(state.revision), proposed: { publisher: "Provider Press" } };
    if ((body as { baseRevision: string }).baseRevision !== String(state.revision)) throw Object.assign(Object.create(ApiError.prototype), { status: 409, message: "stale" });
    state.revision += 1;
    return { editionId: "E1", revision: String(state.revision), fields: state.fields };
  });
  return state;
}

async function draftThen() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MetadataTab editions={[{ id: "E1", titleId: "T1", label: "EPUB", file: { format: "epub" } } as unknown as Edition]} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Auto-fill" }));
  await screen.findByTestId("autofill-draft");
  return qc;
}

test("a draft is saved against the revision it was proposed for, so a change made elsewhere is a conflict", async () => {
  const state = server();
  const qc = await draftThen();
  state.revision = 5; // someone else saved, and this tab then refetched
  await qc.invalidateQueries();
  fireEvent.click(screen.getByRole("button", { name: /^Save 1 field/ }));
  expect(await screen.findByText(/changed after Auto-fill ran/)).toBeTruthy();
  expect(saves()).toEqual([{ fields: ["publisher:set"], base: "4" }]);
  expect(screen.getByTestId("autofill-draft")).toBeTruthy();
});

test("a change made from this tab does not turn the waiting draft into a conflict", async () => {
  server();
  await draftThen();
  fireEvent.click(screen.getByRole("button", { name: "Lock Language as it is" }));
  await waitFor(() => expect(saves()).toHaveLength(1));
  await waitFor(() => expect((screen.getByRole("button", { name: /^Save 1 field/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /^Save 1 field/ }));
  await waitFor(() => expect(screen.queryByTestId("autofill-draft")).toBeNull());
  expect(saves()).toEqual([{ fields: ["language:lock"], base: "4" }, { fields: ["publisher:set"], base: "5" }]);
});
