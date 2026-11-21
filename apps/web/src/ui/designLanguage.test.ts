import { expect, test } from "vitest";

// Enforces the rules marked [enforced] in design/DESIGN-LANGUAGE.md. A failure names the file and the rule.

const raw = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/test-setup.ts"], { query: "?raw", import: "default", eager: true });
const pkgRaw = import.meta.glob<string>("/package.json", { query: "?raw", import: "default", eager: true });

const sources = Object.entries(raw).map(([path, text]) => ({ path: path.replace("/src/", ""), text }));
const tsx = sources.filter((s) => s.path.endsWith(".tsx"));

function offenders(list: { path: string; text: string }[], re: RegExp): string[] {
  return list.filter((s) => re.test(s.text)).map((s) => s.path);
}

test("the scan sees the application source", () => {
  expect(tsx.length).toBeGreaterThan(30);
});

test("rule 1.5: UI SDK is the only component library (ADR-0079)", () => {
  expect(offenders(sources, /from\s+["'](@mantine|@mui|@chakra-ui|antd|@radix-ui|@headlessui|react-bootstrap)/)).toEqual([]);
  const pkg = JSON.parse(Object.values(pkgRaw)[0]) as { dependencies?: object; devDependencies?: object };
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  expect(deps.filter((d) => /^(@mantine|@mui|@chakra-ui|antd|@radix-ui|@headlessui)/.test(d))).toEqual([]);
});

test("rule 2: no raw colors in .tsx; colors come from tokens", () => {
  expect(offenders(tsx, /#[0-9a-fA-F]{3,8}\b(?!["'`]?\s*\/?>)|\brgba?\(|\bhsla?\(/)).toEqual([]);
});

test("rule 2: inline style only sets a CSS custom property", () => {
  expect(offenders(tsx, /style=\{\{(?!\s*["']--)/)).toEqual([]);
});

test("rule 1.5: do not hand-roll widgets UI SDK ships", () => {
  const banned = /role=["'](dialog|alertdialog|menu|menubar|menuitem|tablist|tab|tabpanel|listbox|option|switch|slider|radiogroup|radio|toolbar|tree|treeitem|separator|combobox|progressbar)["']/;
  expect(offenders(tsx, banned)).toEqual([]);
});

test("screens use the kit: no raw buttons, inputs or tables outside src/ui", () => {
  // ProofPage is a reader-engine harness compiled only for proof builds; its raw file input is what the browser proof drives.
  const screens = tsx.filter((s) => !s.path.startsWith("ui/") && s.path !== "reader/ProofPage.tsx");
  expect(offenders(screens, /<(button|input|select|textarea|table)[\s>]/)).toEqual([]);
});

test("section 5: every labelled action button carries an icon", () => {
  // Scan each <Button ...>text</Button> in screens. Icon-only controls use IconAction/IconButton; two audio skip buttons
  // are named by their aria-label, and the table of contents entries are navigation rows, not actions.
  const missing: string[] = [];
  for (const { path, text } of tsx) {
    if (path.startsWith("ui/")) continue;
    let i = 0;
    for (;;) {
      const j = text.indexOf("<Button", i);
      if (j < 0) break;
      i = j + 7;
      if (!" >\n".includes(text[i] ?? "")) continue;
      let k = i, depth = 0, quote = "";
      for (; k < text.length; k++) {
        const c = text[k]!;
        if (quote) { if (c === quote) quote = ""; } else if ("\"'`".includes(c)) quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      const tag = text.slice(j, k + 1);
      if (tag.endsWith("/>") || tag.includes("icon=") || tag.includes('variant="subtle" disabled')) continue;
      const children = text.slice(k + 1, text.indexOf("</Button>", k));
      if (/^[−+]\d+s$/.test(children.trim()) || children.includes("(untitled)") || children.includes("{c.label}")) continue;
      missing.push(`${path}: ${children.trim().slice(0, 40)}`);
    }
  }
  expect(missing).toEqual([]);
});
