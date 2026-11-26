import { describe, expect, test } from "vitest";
import { countWireRules, emptyRoot, fromWire, hasListValue, isSavable, newGroup, newRule, operatorsFor, parseParam, stringifyParam, toWire, withField, type DraftGroup } from "./filterTree";

const group = (join: "AND" | "OR", ...rules: DraftGroup["rules"]): DraftGroup => ({ ...emptyRoot(), join, rules });

describe("filter tree", () => {
  test("a shelf saves only a draft with at least one rule and no incomplete rule", () => {
    const done = { ...newRule("tag"), value: "space opera" };
    expect(isSavable(emptyRoot())).toBe(false);
    expect(isSavable(group("AND", newRule("title")))).toBe(false);
    expect(isSavable(group("AND", done, newRule("title")))).toBe(false); // a search would silently drop the blank one
    expect(isSavable(group("AND", done))).toBe(true);
  });

  test("a rule with a list of values is detected at any depth", () => {
    const list = { type: "rule" as const, field: "format", operator: "is", value: ["mp3", "m4b"] };
    expect(hasListValue({ type: "group", join: "AND", rules: [{ type: "group", join: "OR", rules: [list] }] })).toBe(true);
    expect(hasListValue({ type: "group", join: "AND", rules: [{ ...list, value: "mp3" }] })).toBe(false);
  });

  test("an empty tree and incomplete rules send nothing", () => {
    expect(toWire(emptyRoot())).toBeNull();
    const blank = newRule("title"); // no value yet
    expect(toWire(group("AND", blank))).toBeNull();
  });

  test("complete rules become a wire tree, with numbers as numbers", () => {
    const author = { ...newRule("author"), operator: "contains", value: " Doyle " };
    const rating = { ...newRule("rating"), operator: "between", value: "3", valueTo: "4.5" };
    const nested = group("OR", author, rating);
    const wire = toWire(group("AND", { ...newRule("format"), operator: "is", value: "epub" }, nested));
    expect(wire).toEqual({
      type: "group", join: "AND", rules: [
        { type: "rule", field: "format", operator: "is", value: "epub" },
        { type: "group", join: "OR", rules: [
          { type: "rule", field: "author", operator: "contains", value: "Doyle" },
          { type: "rule", field: "rating", operator: "between", value: 3, valueTo: 4.5 },
        ] },
      ],
    });
  });

  test("a rule that needs no value is sent without one, and an empty group is dropped", () => {
    const wire = toWire(group("AND", { ...newRule("author"), operator: "is_empty" }, group("OR")));
    expect(wire).toEqual({ type: "group", join: "AND", rules: [{ type: "rule", field: "author", operator: "is_empty" }] });
  });

  test("flags send booleans", () => {
    const wire = toWire(group("AND", { ...newRule("has_audio"), value: "false" }));
    expect(wire?.rules?.[0]?.value).toBe(false);
  });

  test("changing the field resets a condition the new field cannot take", () => {
    const r = withField({ ...newRule("title"), operator: "contains", value: "x" }, "status");
    expect(operatorsFor("status").map((o) => o.value)).toContain(r.operator);
    expect(r.operator).toBe("is");
  });

  test("the URL form round-trips", () => {
    const wire = toWire(group("AND", { ...newRule("series"), operator: "contains", value: "Holmes" }, newGroup("OR")));
    const back = parseParam(stringifyParam(wire));
    expect(back).toEqual(wire);
    expect(countWireRules(back)).toBe(1);
    expect(toWire(fromWire(back))).toEqual(wire);
    expect(parseParam("not json")).toBeNull();
    expect(parseParam('{"type":"nope"}')).toBeNull();
  });
});
