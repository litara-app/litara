#!/usr/bin/env bash
# Tiny adb UI helpers for the owned emulator. Usage: adbui.sh shot OUT.png | dump | tap TEXT_OR_DESC | text STRING | key KEYCODE
set -euo pipefail
ADB="${ANDROID_HOME:?}/platform-tools/adb.exe"
S="${ANDROID_SERIAL:-emulator-5554}"
case "$1" in
  shot) "$ADB" -s "$S" exec-out screencap -p > "$2" ;;
  dump) "$ADB" -s "$S" shell uiautomator dump /sdcard/ui.xml >/dev/null && "$ADB" -s "$S" exec-out cat /sdcard/ui.xml ;;
  tap) # tap the center of the first node whose text, content-desc or resource-id contains $2
    xml="$("$0" dump)"
    XML="$xml" Q="$2" PYTHONUTF8=1 python - "$ADB" "$S" <<'PY'
import os,re,subprocess,sys
adb,s=sys.argv[1:3]; q=os.environ['Q']
for m in re.finditer(r'<node [^>]*>',os.environ['XML']):
    n=m.group(0)
    if any(q in (re.search(a+r'="([^"]*)"',n) or [None,''])[1] for a in ('text','content-desc','resource-id')):
        b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n).groups(); x=(int(b[0])+int(b[2]))//2; y=(int(b[1])+int(b[3]))//2
        subprocess.run([adb,'-s',s,'shell','input','tap',str(x),str(y)],check=True); print('tapped',q,x,y); break
else: sys.exit('not found: '+q)
PY
    ;;
  text) "$ADB" -s "$S" shell input text "$2" ;;
  key) "$ADB" -s "$S" shell input keyevent "$2" ;;
esac
