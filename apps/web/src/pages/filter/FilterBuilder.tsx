import { useEffect, useState } from "react";
import type { Library } from "../../api/types";
import { Button, Card, ColumnFilter, CompactSelect, Grow, Heading, IconAction, icons, Row, SegmentedField, Stack, Text } from "../../ui";
import {
  countRules, emptyRoot, FIELDS, fieldOf, fromWire, MAX_DEPTH, MAX_RULES, needsSecondValue, needsValue, newGroup, newRule, operatorsFor, removeNode,
  stringifyParam, toWire, updateGroup, updateRule, withField, type DraftGroup, type DraftRule, type WireFilter,
} from "./filterTree";

const FORMATS = ["epub", "pdf", "mobi", "azw3", "cbz", "cbr", "m4b", "mp3", "audio"].map((f) => ({ value: f, label: f.toUpperCase() }));
const STATUSES = [{ value: "unread", label: "Unread" }, { value: "reading", label: "Reading" }, { value: "finished", label: "Finished" }];
const YES_NO = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
const FIELD_ITEMS = FIELDS.map((f) => ({ value: f.id, label: f.label }));

/** The value control for one rule, chosen by the field's kind. */
function ValueEditor({ rule, libraries, onChange }: { rule: DraftRule; libraries: Library[]; onChange: (r: DraftRule) => void }) {
  const kind = fieldOf(rule.field).kind;
  if (!needsValue(rule.operator)) return <Grow><Text size="sm" tone="dim">No value needed</Text></Grow>;
  const set = (value: string | null) => onChange({ ...rule, value: value ?? undefined });
  if (kind === "format") return <Grow><CompactSelect label="Format" items={FORMATS} value={rule.value ?? null} onValue={set} placeholder="Choose a format" /></Grow>;
  if (kind === "status") return <Grow><CompactSelect label="Status" items={STATUSES} value={rule.value ?? null} onValue={set} placeholder="Choose a status" /></Grow>;
  if (kind === "flag") return <Grow><CompactSelect label="Answer" items={YES_NO} value={rule.value ?? "true"} onValue={set} /></Grow>;
  if (kind === "library") {
    return <Grow><CompactSelect label="Library" items={libraries.map((l) => ({ value: l.id, label: l.name }))} value={rule.value ?? null} onValue={set} placeholder="Choose a library" emptyText="No libraries yet" /></Grow>;
  }
  const type = kind === "number" || kind === "rating" ? "number" : kind === "date" ? "date" : "text";
  const hint = kind === "rating" ? "0.5 to 5" : kind === "date" ? undefined : kind === "number" ? "Number" : "Value";
  return (
    <Row gap="xs" grow>
      <Grow><ColumnFilter label={`${fieldOf(rule.field).label} value`} type={type} placeholder={hint} value={rule.value ?? ""} onValue={(v) => onChange({ ...rule, value: v })} /></Grow>
      {needsSecondValue(rule.operator) && (
        <Grow><ColumnFilter label={`${fieldOf(rule.field).label} upper value`} type={type} placeholder={hint} value={rule.valueTo ?? ""} onValue={(v) => onChange({ ...rule, valueTo: v })} /></Grow>
      )}
    </Row>
  );
}

function RuleRow({ rule, libraries, onChange, onRemove }: { rule: DraftRule; libraries: Library[]; onChange: (r: DraftRule) => void; onRemove: () => void }) {
  return (
    <div className="lt-fb-row" data-testid="filter-rule">
      <CompactSelect label="Field" items={FIELD_ITEMS} value={rule.field} onValue={(v) => v && onChange(withField(rule, v))} />
      <CompactSelect label="Condition" items={operatorsFor(rule.field)} value={rule.operator} onValue={(v) => v && onChange({ ...rule, operator: v })} />
      <ValueEditor rule={rule} libraries={libraries} onChange={onChange} />
      <IconAction label={`Remove ${fieldOf(rule.field).label} filter`} icon={icons.close} onClick={onRemove} />
    </div>
  );
}

function GroupView({ group, depth, root, setRoot, libraries, total }: {
  group: DraftGroup; depth: number; root: DraftGroup; setRoot: (g: DraftGroup) => void; libraries: Library[]; total: number;
}) {
  const nested = depth > 1;
  return (
    <div className={nested ? "lt-fb-rail" : undefined} role="group" aria-label={`${group.join === "AND" ? "All of" : "Any of"} these`} data-testid="filter-group">
      <Row gap="sm" align="stretch">
        <SegmentedField label="Combine rules" value={group.join} onValue={(v) => setRoot(updateGroup(root, group.id, (g) => ({ ...g, join: v === "OR" ? "OR" : "AND" })))}
          items={[{ value: "AND", label: "All of" }, { value: "OR", label: "Any of" }]} />
        <Text size="sm" tone="dim">these are true</Text>
        <Grow />
        {nested && <IconAction label="Remove group" icon={icons.trash} onClick={() => setRoot(removeNode(root, group.id))} />}
      </Row>
      {group.rules.map((n) => n.type === "rule"
        ? <RuleRow key={n.id} rule={n} libraries={libraries} onChange={(r) => setRoot(updateRule(root, n.id, () => r))} onRemove={() => setRoot(removeNode(root, n.id))} />
        : <GroupView key={n.id} group={n} depth={depth + 1} root={root} setRoot={setRoot} libraries={libraries} total={total} />)}
      <Row gap="xs">
        <Button size="sm" variant="subtle" icon={icons.plus} disabled={total >= MAX_RULES}
          onClick={() => setRoot(updateGroup(root, group.id, (g) => ({ ...g, rules: [...g.rules, newRule()] })))}>Add filter</Button>
        <Button size="sm" variant="subtle" icon={icons.list} disabled={depth >= MAX_DEPTH || total >= MAX_RULES}
          onClick={() => setRoot(updateGroup(root, group.id, (g) => ({ ...g, rules: [...g.rules, newGroup()] })))}>Add group</Button>
      </Row>
    </div>
  );
}

/**
 * The rule builder (ADR-0085, mockup A): nested AND/OR groups of field, condition and value rows. Nothing is sent
 * until Apply; incomplete rules are dropped when applying.
 */
export function FilterBuilder({ applied, libraries, onApply }: { applied: WireFilter | null; libraries: Library[]; onApply: (w: WireFilter | null) => void }) {
  const key = stringifyParam(applied);
  const [root, setRoot] = useState<DraftGroup>(() => fromWire(applied));
  useEffect(() => setRoot(fromWire(applied)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = countRules(root);
  const pending = stringifyParam(toWire(root));
  const changed = pending !== key;
  return (
    <Card framed data-testid="filter-builder">
      <Stack gap="sm">
        <Heading level={3}>Filters</Heading>
        <GroupView group={root} depth={1} root={root} setRoot={setRoot} libraries={libraries} total={total} />
        <Row justify="between">
          <Text size="sm" tone="dim">{total} {total === 1 ? "rule" : "rules"}{changed ? " · not applied yet" : ""}</Text>
          <Row gap="xs">
            <Button icon={icons.close} onClick={() => { setRoot(emptyRoot()); onApply(null); }} disabled={total === 0 && !key}>Clear</Button>
            <Button variant="primary" icon={icons.check} onClick={() => onApply(toWire(root))} disabled={!changed}>Apply filters</Button>
          </Row>
        </Row>
      </Stack>
    </Card>
  );
}

export type { WireFilter };
