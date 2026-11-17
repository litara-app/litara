"""Check T007 assignment integrity using only the Python standard library.

Static preparation only: does not run the application or accept release gates.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def require(condition, detail):
    if not condition:
        raise SystemExit("T007 READINESS FAILED: " + detail)


required = [
    "handoffs/T007-assignment.md", "contracts/t007/README.md",
    "research/t007/decisions.md", "research/t007/gaps.md",
    "research/t007/resources.md", "research/t007/readiness.md",
    "TASKS.md", "AGENTS.md",
]
for name in required:
    require((ROOT / name).is_file(), "missing " + name)

contract = json.loads(read("contracts/t007/scenarios.json"))
ledger = json.loads(read("research/t007/coverage.json"))
require(contract["schemaVersion"] == ledger["schemaVersion"] == 1, "schema version")
require(contract["task"] == ledger["task"] == "T007", "task identity")
require(contract["baseline"] == "8de06b96c704bbf2a6067dc4df61a25401390393", "baseline")
states = {"pending", "passed", "failed", "partial", "blocked", "not-applicable"}
require(set(contract["states"]) == states, "result states")
phases = {"local", "assisted", "external", "cast-last", "release-hold"}
gaps = set(re.findall(r"\| (G\d{2}) \|", read("research/t007/gaps.md")))
require(len(gaps) == 18, "inherited gap inventory")
ids, used_gaps = set(), set()
for scenario in contract["scenarios"]:
    key = scenario["id"]
    require(key not in ids, "duplicate scenario " + key)
    ids.add(key)
    require(re.fullmatch(r"[a-z][a-z0-9-]+", key), "scenario id " + key)
    require(scenario["phase"] in phases, "phase " + key)
    for field in ("title", "expect", "evidence", "gaps", "adrs"):
        require(bool(scenario[field]), field + " missing for " + key)
    require(set(scenario["gaps"]) <= gaps, "unknown gap " + key)
    used_gaps.update(scenario["gaps"])
    for adr in scenario["adrs"]:
        files = list((ROOT / "ADR").glob(adr + "-*.md"))
        require(len(files) == 1, "missing/ambiguous ADR " + adr)
        require("\nStatus: Accepted\n" in files[0].read_text(encoding="utf-8"), "unaccepted ADR " + adr)
require(used_gaps == gaps, "unreferenced inherited gaps")
require({s["phase"] for s in contract["scenarios"]} == phases, "missing phase")
require(len(ids) >= 32, "missing original scenarios")

rows = ledger["scenarios"]
require(len(rows) == len(ids), "ledger count")
require({r["id"] for r in rows} == ids, "ledger identities")
for row in rows:
    require(row["state"] in states, "invalid ledger state " + row["id"])
    for field in ("command", "environment", "blocker", "evidencePaths"):
        require(field in row, "missing result field " + field)
    if row["state"] != "pending":
        require(row["command"] and row["environment"] and row["evidencePaths"], "missing run evidence " + row["id"])
    if row["state"] in {"partial", "blocked", "failed", "not-applicable"}:
        require(row["blocker"], "missing limitation/disposition " + row["id"])
    for name in row["evidencePaths"]:
        path = Path(name)
        require(not path.is_absolute() and ":" not in name and ".." not in path.parts, "unsafe evidence path")
        require((ROOT / path).is_file(), "missing evidence file " + name)

# Check relative Markdown links in the new preparation documents, excluding
# external URLs and inline code. Absolute/private workstation paths aren't portable.
for name in required + ["contracts/t007/README.md"]:
    for target in re.findall(r"(?<!!)\[[^\]]+\]\(([^)]+)\)", read(name)):
        if "://" in target or target.startswith("#"):
            continue
        target = target.split("#", 1)[0]
        require((ROOT / name).parent.joinpath(target).exists(), "broken link " + name + " -> " + target)

register = read("TASKS.md")
require("codex/t007-readiness" in register and "T008" in register, "register/checkpoint or migration package missing")
brief = read("handoffs/T007-assignment.md")
for marker in ("Chromecast last", "No CI activation", "T008", "AGPL", "engine", "both emulator suites"):
    require(marker in brief, "missing assignment boundary " + marker)
counts = {state: sum(r["state"] == state for r in rows) for state in sorted(states)}
print(f"T007 PREPARATION OK: {len(ids)} scenarios, {len(gaps)} gaps, {len(phases)} phases; ledger {counts}")
print("Static integrity only; no application, reader, hardware, migration or release acceptance is claimed.")
