#!/usr/bin/env bash
# F10 regression on the emulator: a position saved while OFFLINE (player opened after a force-close, kept open across the reconnect) must reach the server after reconnecting
# without being refused as a stale conflict.
#   Needs: `python scripts/t007/audio_corpus.py --keep` stack, the debug app signed in as the synthetic reader (Library visible),
#   ANDROID_HOME, emulator-5554. Writes research/t007/evidence/m4-phone/f10-emulator-check.txt
set -uo pipefail
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1 ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
cd "$(dirname "$0")/../.."
A="$ANDROID_HOME/platform-tools/adb.exe"
out=research/t007/evidence/m4-phone/f10-emulator-check.txt
ui() { bash scripts/t007/adbui.sh "$@"; }
sqlq() { docker exec litara-t007-pg psql -U postgres -d t007android -At -c "$1"; }
note() { echo "$*" | tee -a "$out"; }
: > "$out"
note "F10 emulator check $(date -u +%FT%TZ), app: $("$A" shell dumpsys package com.litara.debug | grep -m1 versionName | tr -d ' \r')"
q="select p.revision||'|'||p.offset_ms from position_state p join recordings r on r.id=p.recording_id join titles t on t.id=r.title_id where t.title='Format MP3'"
conf="select count(*) from conflicts c join recordings r on r.id=c.recording_id join titles t on t.id=r.title_id where t.title='Format MP3' and c.resolved_at is null"
ui tap "Library" >/dev/null 2>&1; sleep 2
ui tap "Format MP3" >/dev/null; sleep 3
ui tap "Download" >/dev/null; for i in $(seq 1 30); do ui dump 2>/dev/null | grep -q "Downloaded" && break; sleep 2; done
ui dump 2>/dev/null | grep -q "Downloaded" && note "downloaded: yes" || note "downloaded: NO"
ui tap "Play" >/dev/null; sleep 3
"$A" shell input tap 300 2243; sleep 4        # seek to ~20 percent, play on
ui tap "Close" >/dev/null 2>&1; sleep 4
note "online save -> server position (revision|offset_ms): $(sqlq "$q")  open conflicts: $(sqlq "$conf")"
rev_online=$(sqlq "$q" | cut -d'|' -f1)
# go offline
"$A" shell cmd connectivity airplane-mode enable >/dev/null 2>&1; "$A" shell svc wifi disable >/dev/null 2>&1; "$A" shell svc data disable >/dev/null 2>&1; sleep 5
note "network while offline: $("$A" shell dumpsys connectivity | grep -c 'state: CONNECTED') connected networks"
"$A" shell am force-stop com.litara.debug; sleep 2
"$A" shell monkey -p com.litara.debug -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 8
ui tap "Downloads" >/dev/null 2>&1; sleep 3
ui tap "Format MP3" >/dev/null 2>&1; sleep 3
ui tap "Play" >/dev/null 2>&1; sleep 3
"$A" shell input tap 950 2243; sleep 4        # seek to ~80 percent offline, play on
note "offline: server position still (revision|offset_ms): $(sqlq "$q")"
# back online
"$A" shell cmd connectivity airplane-mode disable >/dev/null 2>&1; "$A" shell svc wifi enable >/dev/null 2>&1; "$A" shell svc data enable >/dev/null 2>&1; sleep 40   # the player opened offline stays open across the reconnect (the phone case): queued writes are flushed by that same session
ui tap "Close" >/dev/null 2>&1; sleep 3
after=$(sqlq "$q"); c=$(sqlq "$conf")
note "after reconnect -> server position (revision|offset_ms): $after   unresolved conflicts: $c"
off=$(echo "$after" | cut -d'|' -f2); rev=$(echo "$after" | cut -d'|' -f1)
if [ "${c:-1}" = "0" ] && [ "${off:-0}" -gt 12000 ] && [ "${rev:-0}" -gt "${rev_online:-0}" ]; then note "RESULT: PASS (offline progress accepted, no stale conflict)"; else note "RESULT: FAIL"; fi
