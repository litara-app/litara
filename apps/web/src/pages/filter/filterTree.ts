/**
 * The filter tree (ADR-0085): the working copy the builder edits, the wire shape the server takes, and the URL form.
 * The field and operator catalogue mirrors the server's (`catalog/titlefilter.go`); the server decides what is valid.
 */

export type Join = "AND" | "OR";
export type FieldKind = "text" | "format" | "status" | "library" | "number" | "rating" | "date" | "flag";

export interface FieldDef { id: string; label: string; kind: FieldKind }

export const MAX_DEPTH = 3;
export const MAX_RULES = 30;

export const FIELDS: FieldDef[] = [
  { id: "title", label: "Title", kind: "text" },
  { id: "author", label: "Author", kind: "text" },
  { id: "series", label: "Series", kind: "text" },
  { id: "publisher", label: "Publisher", kind: "text" },
  { id: "language", label: "Language", kind: "text" },
  { id: "format", label: "Format", kind: "format" },
  { id: "tag", label: "Tag", kind: "text" },
  { id: "status", label: "Status", kind: "status" },
  { id: "library", label: "Library", kind: "library" },
  { id: "rating", label: "Rating (stars)", kind: "rating" },
  { id: "published", label: "Published (year)", kind: "number" },
  { id: "added", label: "Added", kind: "date" },
  { id: "pages", label: "Pages", kind: "number" },
  { id: "series_index", label: "Series number", kind: "number" },
  { id: "has_ebook", label: "Has an ebook", kind: "flag" },
  { id: "has_audio", label: "Has an audiobook", kind: "flag" },
  { id: "has_description", label: "Has a description", kind: "flag" },
];

const OP_LABELS: Record<string, string> = {
  is: "is", is_not: "is not", contains: "contains", not_contains: "does not contain", is_empty: "is empty", not_empty: "is not empty",
  gt: "is greater than", gte: "is at least", lt: "is less than", lte: "is at most", between: "is between", before: "is before", after: "is after",
};

const OPS: Record<FieldKind, string[]> = {
  text: ["is", "is_not", "contains", "not_contains", "is_empty", "not_empty"],
  format: ["is", "is_not", "is_empty", "not_empty"],
  status: ["is", "is_not"],
  library: ["is", "is_not"],
  number: ["is", "is_not", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"],
  rating: ["is", "is_not", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"],
  date: ["before", "after", "between"],
  flag: ["is"],
};

export const fieldOf = (id: string): FieldDef => FIELDS.find((f) => f.id === id) ?? FIELDS[0]!;
export const operatorsFor = (field: string) => OPS[fieldOf(field).kind].map((value) => ({ value, label: OP_LABELS[value]! }));
export const needsValue = (op: string) => op !== "is_empty" && op !== "not_empty";
export const needsSecondValue = (op: string) => op === "between";

export interface DraftRule { type: "rule"; id: number; field: string; operator: string; value?: string; valueTo?: string }
export interface DraftGroup { type: "group"; id: number; join: Join; rules: DraftNode[] }
export type DraftNode = DraftRule | DraftGroup;

let nextId = 1;
export const newRule = (field = "author"): DraftRule => ({ type: "rule", id: nextId++, field, operator: operatorsFor(field)[0]!.value, value: defaultValue(field) });
export const newGroup = (join: Join = "OR"): DraftGroup => ({ type: "group", id: nextId++, join, rules: [newRule()] });
export const emptyRoot = (): DraftGroup => ({ type: "group", id: nextId++, join: "AND", rules: [] });

function defaultValue(field: string): string | undefined {
  const kind = fieldOf(field).kind;
  if (kind === "flag") return "true";
  if (kind === "status") return "unread";
  return undefined;
}

/** Changing the field resets an operator or value the new field cannot take. */
export function withField(rule: DraftRule, field: string): DraftRule {
  const ok = operatorsFor(field).some((o) => o.value === rule.operator);
  return { ...rule, field, operator: ok ? rule.operator : operatorsFor(field)[0]!.value, value: defaultValue(field), valueTo: undefined };
}

export function countRules(node: DraftNode): number {
  return node.type === "rule" ? 1 : node.rules.reduce((n, r) => n + countRules(r), 0);
}

/** Replace, remove or insert within a group by node id; returns a new tree. */
export function updateGroup(root: DraftGroup, groupId: number, fn: (g: DraftGroup) => DraftGroup): DraftGroup {
  if (root.id === groupId) return fn(root);
  return { ...root, rules: root.rules.map((r) => (r.type === "group" ? updateGroup(r, groupId, fn) : r)) };
}
export function updateRule(root: DraftGroup, ruleId: number, fn: (r: DraftRule) => DraftRule): DraftGroup {
  return { ...root, rules: root.rules.map((n) => (n.type === "group" ? updateRule(n, ruleId, fn) : n.id === ruleId ? fn(n) : n)) };
}
export function removeNode(root: DraftGroup, id: number): DraftGroup {
  return { ...root, rules: root.rules.filter((n) => n.id !== id).map((n) => (n.type === "group" ? removeNode(n, id) : n)) };
}

export interface WireFilter {
  type: "group" | "rule"; join?: Join; rules?: WireFilter[]; field?: string; operator?: string; value?: unknown; valueTo?: unknown;
}

function numberValue(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Is the rule complete enough to send? An incomplete rule is dropped, not sent as a half-built filter. */
function wireRule(r: DraftRule): WireFilter | null {
  const kind = fieldOf(r.field).kind;
  const base = { type: "rule" as const, field: r.field, operator: r.operator };
  if (!needsValue(r.operator)) return base;
  if (kind === "number" || kind === "rating") {
    const a = numberValue(r.value);
    if (a === null) return null;
    if (!needsSecondValue(r.operator)) return { ...base, value: a };
    const b = numberValue(r.valueTo);
    return b === null ? null : { ...base, value: a, valueTo: b };
  }
  if (kind === "date") {
    if (!r.value) return null;
    if (!needsSecondValue(r.operator)) return { ...base, value: r.value };
    return r.valueTo ? { ...base, value: r.value, valueTo: r.valueTo } : null;
  }
  if (kind === "flag") return { ...base, value: r.value !== "false" };
  const v = (r.value ?? "").trim();
  return v ? { ...base, value: v } : null;
}

/**
 * Can this draft be saved on a smart shelf? A search drops incomplete rules, but a shelf must not: dropping one would
 * save a different filter from the one on screen. A shelf also needs at least one rule.
 */
export function isSavable(root: DraftGroup): boolean {
  const total = countRules(root);
  return total > 0 && countWireRules(toWire(root)) === total;
}

/** The builder holds one value per rule. A stored rule with a list of values cannot be edited here without changing it. */
export function hasListValue(w: WireFilter): boolean {
  return Array.isArray(w.value) || (w.rules ?? []).some(hasListValue);
}

/** The tree as the server takes it; empty groups and incomplete rules are removed. Returns null when nothing is left. */
export function toWire(node: DraftNode): WireFilter | null {
  if (node.type === "rule") return wireRule(node);
  const rules = node.rules.map(toWire).filter((x): x is WireFilter => x !== null);
  return rules.length ? { type: "group", join: node.join, rules } : null;
}

/** A wire tree (from the URL) back into a working copy. */
export function fromWire(w: WireFilter | null | undefined): DraftGroup {
  if (!w) return emptyRoot();
  const rules = w.type === "group" ? (w.rules ?? []).map(nodeFromWire) : [nodeFromWire(w)];
  return { type: "group", id: nextId++, join: w.type === "group" ? w.join ?? "AND" : "AND", rules };
}
function nodeFromWire(w: WireFilter): DraftNode {
  if (w.type === "group") return { type: "group", id: nextId++, join: w.join ?? "AND", rules: (w.rules ?? []).map(nodeFromWire) };
  const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  return { type: "rule", id: nextId++, field: w.field ?? "title", operator: w.operator ?? "is", value: str(w.value), valueTo: str(w.valueTo) };
}

export function countWireRules(w: WireFilter | null): number {
  if (!w) return 0;
  return w.type === "rule" ? 1 : (w.rules ?? []).reduce((n, r) => n + countWireRules(r), 0);
}

/** The applied tree lives in the page URL as JSON, so a filtered view can be shared and reloaded. */
export function parseParam(raw: string | null): WireFilter | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as WireFilter;
    return v && (v.type === "group" || v.type === "rule") ? v : null;
  } catch { return null; }
}
export const stringifyParam = (w: WireFilter | null): string => (w ? JSON.stringify(w) : "");
