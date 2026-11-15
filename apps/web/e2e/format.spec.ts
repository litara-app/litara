import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Format corpus: every generated fixture must reach an explicit, observable state in each browser.
// Results are written to test-results/format-matrix/<browser>.json and merged into
// research/t005/format-matrix.md by scripts/web/format_matrix.py.

const PASSWORD = "synthetic-fixture-password";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill("fixture-user-a");
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}

type Result = { fixture: string; kind: string; format: string; outcome: string; detail: string };

const ebooks: { title: RegExp; label: string; expect?: "rendered" | "explicit" }[] = [
  { title: /^Corpus EPUB$/i, label: "EPUB", expect: "rendered" },
  { title: /^Corpus KEPUB$/i, label: "KEPUB (EPUB container, no Kobo spans)" },
  { title: /^Corpus Fixed Layout$/i, label: "Fixed-layout EPUB" },
  { title: /^Corpus FB2$/i, label: "FB2", expect: "rendered" },
  { title: /^corpus-pdf$/i, label: "PDF (text)", expect: "rendered" },
  { title: /^corpus-mobi$/i, label: "MOBI (Calibre)" },
  { title: /^corpus-azw3$/i, label: "AZW3/KF8 (Calibre)" },
  { title: /^corpus-damaged$/i, label: "Damaged EPUB (truncated)", expect: "explicit" },
  { title: /^The Test Comic$/, label: "CBZ comic", expect: "rendered" },
  { title: /^The Hostile Comic$/, label: "CBZ hostile (traversal)", expect: "explicit" },
  { title: /^legacy$/i, label: "CBR comic", expect: "explicit" },
];
const audio = ["mp3", "m4a", "m4b", "ogg", "opus", "flac", "wav"];

async function titleIndex(page: Page) {
  const out = new Map<string, { id: string; format: string; recording?: boolean }>();
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  for (const t of titles) {
    const eds = (await (await page.request.get(`/api/v1/editions?titleId=${t.id}`)).json()).items as { id: string; file: { format: string } }[];
    if (eds[0]) out.set(t.title, { id: eds[0].id, format: eds[0].file.format });
    const recs = (await (await page.request.get(`/api/v1/titles/${t.id}/recordings`)).json()).items as { id: string }[];
    if (recs[0]) out.set(t.title, { id: recs[0].id, format: "audio", recording: true });
  }
  return out;
}

const results: Result[] = [];

/** Poll the page until it shows content, an explicit failure, or has been idle without either. */
async function settle(page: Page): Promise<string> {
  let quiet = 0;
  for (let i = 0; i < 80; i++) {
    if (await page.getByRole("alert").filter({ hasNotText: "Limited support" }).count() || await page.getByTestId("comic-unsupported").count() || await page.getByText("cannot be opened in the browser yet").count()) return "explicit-error";
    const progress = (await page.getByTestId("progress").allInnerTexts()).join("").trim();
    if (progress || await page.getByTestId("comic-progress").count()) return "rendered";
    const loading = await page.getByLabel("Loading").count();
    quiet = loading ? 0 : quiet + 1;
    if (quiet >= 8) return "rendered-without-progress"; // loaded, nothing failed, no location reported
    await page.waitForTimeout(400);
  }
  return "no-state";
}

test.describe.configure({ mode: "serial" });

test("every ebook, comic and damaged fixture reaches an explicit state", async ({ page, browserName }) => {
  test.setTimeout(240_000);
  await signIn(page);
  const idx = await titleIndex(page);
  for (const f of ebooks) {
    const hit = [...idx.entries()].find(([t]) => f.title.test(t));
    if (!hit) { results.push({ fixture: f.label, kind: "ebook", format: "?", outcome: "not generated", detail: "fixture missing from the library" }); continue; }
    const [, v] = hit;
    await page.goto(`/read/${v.id}`);
    const state = await settle(page);
    let detail = "";
    if (state.startsWith("rendered")) {
      // The frame must hold real book text (reflowable) or a drawn PDF canvas, not just chrome.
      await page.waitForTimeout(800);
      const text = await Promise.all(page.frames().filter((x) => x.url().startsWith("blob:")).map((x) => x.locator("body").innerText().catch(() => ""))).then((a) => a.join(" "));
      const pdf = await Promise.all(page.frames().filter((x) => x.url().includes("/frame.html")).map((x) => x.evaluate(() => (document.querySelector("#pdf") as HTMLCanvasElement | null)?.width ?? 0).catch(() => 0)));
      const comic = await page.getByTestId("comic-page").count();
      detail = /quick brown fox|Chapter|Corpus/i.test(text) ? "text drawn" : pdf.some((w) => w > 0) ? "PDF canvas drawn" : comic ? "page image shown" : "chrome only (no content detected)";
    } else if (state.startsWith("explicit")) {
      detail = ((await page.getByRole("alert").filter({ hasNotText: "Limited support" }).first().innerText().catch(() => "")) || (await page.locator("main, body").first().innerText().catch(() => ""))).replace(/\s+/g, " ").slice(0, 140);
    }
    console.log("FIXTURE", f.label, state, detail.slice(0, 60));
    results.push({ fixture: f.label, kind: "ebook", format: v.format, outcome: state, detail });
    if (f.expect === "rendered") expect(state.startsWith("rendered"), f.label).toBe(true);
    if (f.expect === "explicit") expect(state.startsWith("explicit"), `${f.label} must fail visibly, got ${state}`).toBe(true);
    expect(state, `${f.label} must never hang without a state`).not.toBe("no-state");
  }
  fs.mkdirSync("test-results/format-matrix", { recursive: true });
  fs.writeFileSync(path.join("test-results/format-matrix", `ebooks-${browserName}.json`), JSON.stringify(results, null, 2));
});

test("every audio fixture plays or is explained", async ({ page, browserName }) => {
  test.setTimeout(240_000);
  await signIn(page);
  const idx = await titleIndex(page);
  const out: Result[] = [];
  for (const ext of audio) {
    const hit = idx.get(`Corpus Audio ${ext.toUpperCase()}`) ?? idx.get(`corpus-audio-${ext}`);
    if (!hit) { out.push({ fixture: `.${ext}`, kind: "audio", format: ext, outcome: "not generated", detail: "fixture missing from the library" }); continue; }
    await page.goto(`/listen/${hit.id}`);
    await expect(page.getByTestId("listen-title")).toBeVisible({ timeout: 15_000 });
    const warned = await page.getByTestId("unsupported").count();
    const canPlayType = await page.evaluate(() => { const a = document.createElement("audio"); return ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/flac", "audio/wav", 'audio/ogg; codecs="opus"'].map((m) => `${m}=${a.canPlayType(m) || "no"}`).join(","); });
    if (await page.getByTestId("play").isDisabled()) { // the server marks the recording not playable: an explicit state, controls disabled
      const why = (await page.getByText("This recording cannot be played yet").locator("..").innerText().catch(() => "")).replace(/\s+/g, " ");
      out.push({ fixture: `.${ext}`, kind: "audio", format: ext, outcome: "explicit-unsupported", detail: `server readiness: ${why.replace("This recording cannot be played yet", "").trim()} [canPlayType ${canPlayType}]` });
      continue;
    }
    await page.getByTestId("play").click();
    let state = "no-state";
    for (let i = 0; i < 40 && state === "no-state"; i++) { // 12 s, polled so no timer is left dangling
      if (await page.getByTestId("player-error").count()) state = "explicit-error";
      else if ((await page.getByTestId("elapsed").innerText()) !== "0:00") state = "playing";
      else await page.waitForTimeout(300);
    }
    const detail = state === "explicit-error" ? (await page.getByTestId("player-error").innerText().catch(() => "")) : warned ? "browser warned the format may not play" : "";
    out.push({ fixture: `.${ext}`, kind: "audio", format: ext, outcome: state, detail: `${detail} [canPlayType ${canPlayType}]`.trim() });
    expect(state, `.${ext} must play or be explained, never hang`).not.toBe("no-state");
    if (state === "playing") await page.getByTestId("play").click();
  }
  fs.mkdirSync("test-results/format-matrix", { recursive: true });
  fs.writeFileSync(path.join("test-results/format-matrix", `audio-${browserName}.json`), JSON.stringify(out, null, 2));
});
