#!/usr/bin/env bash
# Plays each synthetic audio recording in the real Android app on the emulator and reads the media session state.
#   Needs: the stack from `python scripts/t007/audio_corpus.py --keep`, the debug app signed in as the synthetic reader
#   (Library tab showing the recordings), ANDROID_HOME, emulator-5554.
#   Writes research/t007/evidence/m4-corpus/android-audio-playback.txt
set -uo pipefail
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1 ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
cd "$(dirname "$0")/../.."
A="$ANDROID_HOME/platform-tools/adb.exe"
out=research/t007/evidence/m4-corpus/android-audio-playback.txt
echo "device: $("$A" shell getprop ro.product.model | tr -d '\r') API $("$A" shell getprop ro.build.version.sdk | tr -d '\r'), app: $("$A" shell dumpsys package com.litara.debug | grep -m1 versionName | tr -d ' \r')" > "$out"
pos() { "$A" shell dumpsys media_session | grep -m1 "PlaybackState {" | sed 's/^ *//'; }
num() { sed -n 's/.*position=\([0-9]*\).*/\1/p'; }
state() { sed -n 's/.*state=\([A-Z_]*\)(.*/\1/p'; }
errof() { sed -n 's/.*error=\([^}]*\)}.*/\1/p'; }
ui() { bash scripts/t007/adbui.sh "$@"; }
ui tap "Close" >/dev/null 2>&1; ui tap "Library" >/dev/null 2>&1; sleep 2
for t in "Format AAC" "Format FLAC" "Format M4A" "Format MP3" "Format OGG" "Format OPUS" "Format WAV" "Chaptered M4B"; do
  ui tap "$t" >/dev/null 2>&1 || { echo "$t: NOT FOUND in library" | tee -a "$out"; continue; }
  sleep 3
  ui tap "Play" >/dev/null 2>&1 || { echo "$t: no Play control" | tee -a "$out"; ui tap "Library" >/dev/null 2>&1; continue; }
  sleep 3
  "$A" shell input tap 180 2243; sleep 1   # start from about 10 percent: a recording saved at its end would otherwise show no progress
  "$A" shell input keyevent 126 >/dev/null 2>&1; sleep 1   # MEDIA_PLAY in case the end state stopped it
  s1="$(pos)"; sleep 3; s2="$(pos)"
  p1="$(echo "$s1" | num)"; p2="$(echo "$s2" | num)"; st="$(echo "$s2" | state)"; err="$(echo "$s2" | errof)"
  "$A" shell input tap 1000 2243; sleep 2   # seek: tap the scrubber at about 81 percent
  p3="$(pos | num)"
  adv=FAIL; [ "$st" = "PLAYING" ] && [ "${p2:-0}" -gt "${p1:-0}" ] && adv=PASS
  sk=FAIL; [ "${p3:-0}" -gt 12000 ] && sk=PASS
  echo "$t: play=$adv seek=$sk state=$st position ${p1:-?} -> ${p2:-?} ms, after seek ${p3:-?} ms, error=$err" | tee -a "$out"
  ui tap "Close" >/dev/null 2>&1; sleep 1
  ui tap "Library" >/dev/null 2>&1; sleep 2
done
