#!/usr/bin/env bash
# Fresh app data, then sign in to the disposable stack (http://10.0.2.2:18407) as the synthetic reader on the emulator.
set -uo pipefail
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1 ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
cd "$(dirname "$0")/../.."
A="$ANDROID_HOME/platform-tools/adb.exe"
"$A" shell pm clear com.litara.debug >/dev/null
"$A" shell monkey -p com.litara.debug -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 7
bash scripts/t007/adbui.sh tap "Use a Litara server" >/dev/null; sleep 3
U=$(python -c "import json;print(json.load(open('.tmp/t007/creds.json'))['reader'][0])")
P=$(python -c "import json;print(json.load(open('.tmp/t007/creds.json'))['reader'][1])")
"$A" shell input tap 640 264; sleep 1; "$A" shell input text 'http://10.0.2.2:18407'; "$A" shell input keyevent 111; sleep 1
"$A" shell input tap 640 684; sleep 1; "$A" shell input text "$U"; "$A" shell input keyevent 111; sleep 1
"$A" shell input tap 640 900; sleep 1; "$A" shell input text "$P"; "$A" shell input keyevent 111; sleep 1
"$A" shell input tap 120 443; sleep 1; "$A" shell input tap 184 1079; sleep 12
bash scripts/t007/adbui.sh dump 2>/dev/null | grep -q 'text="Library"' && echo "signed in" || { echo "sign-in FAILED"; exit 1; }
