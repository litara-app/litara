"""Read-only comparison of the external T002 worktree and pinned reference clone."""
import difflib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

REFERENCE = Path("E:/Programming/_reference/bookorbit-android")
CANDIDATE = Path("G:/Programming/ebooker-android-import/apps/android")

def renamed(value):
    return value.replace("BookOrbit", "Litara").replace("bookorbit", "litara").replace("BOOKORBIT", "LITARA")

roots = ["app/src/main/java", "app/src/debug", "app/src/full", "app/src/fdroid", "app/src/test", "app/src/androidTest", "app/src/main/assets/reader", "app/src/main/res"]
files = set()
for root in roots:
    files.update(p.relative_to(REFERENCE) for p in (REFERENCE / root).rglob("*") if p.is_file())
files.update(Path(p) for p in ["app/build.gradle.kts", "app/src/main/AndroidManifest.xml", "build.gradle.kts", "settings.gradle.kts", "gradle.properties", "gradle/libs.versions.toml", "LICENSE"])
same = mechanical = 0
residuals = []
missing = []
for rel in sorted(files):
    src = REFERENCE / rel
    dst = CANDIDATE / renamed(rel.as_posix())
    if not dst.exists():
        missing.append(str(rel))
        continue
    a, b = src.read_bytes(), dst.read_bytes()
    if a == b:
        same += 1
        continue
    try:
        expected, actual = renamed(a.decode("utf-8")).replace("\r\n", "\n"), b.decode("utf-8").replace("\r\n", "\n")
    except UnicodeDecodeError:
        residuals.append({"path": str(rel), "binary": True})
        continue
    if expected == actual:
        mechanical += 1
    else:
        residuals.append({"path": str(rel), "diff": "".join(difflib.unified_diff(expected.splitlines(True), actual.splitlines(True), fromfile="expected mechanical rename", tofile=str(dst)))})

reports = {}
for variant in ["Full", "Fdroid"]:
    directory = CANDIDATE / f"app/build/test-results/test{variant}DebugUnitTest"
    counts = dict(files=0, tests=0, failures=0, errors=0, skipped=0)
    for report in directory.glob("TEST-*.xml"):
        root = ET.parse(report).getroot()
        counts["files"] += 1
        for key in ["tests", "failures", "errors", "skipped"]:
            counts[key] += int(root.attrib.get(key, "0"))
    reports[variant] = counts

instrumentation = {}
for report in (CANDIDATE / "app/build/outputs/androidTest-results/connected").rglob("TEST-*.xml"):
    root = ET.parse(report).getroot()
    instrumentation[str(report.relative_to(CANDIDATE))] = {key: int(root.attrib.get(key, "0")) for key in ["tests", "failures", "errors", "skipped"]}

print(json.dumps({"compared": len(files), "identical": same, "mechanical_rename_only": mechanical, "missing": missing, "residuals": residuals, "existing_unit_reports": reports, "existing_instrumentation_reports": instrumentation}, indent=2))
