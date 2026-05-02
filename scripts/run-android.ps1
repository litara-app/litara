$env:JAVA_HOME = "E:\Android Studio\jbr"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

Write-Host "JAVA_HOME: $env:JAVA_HOME"
java -version

Set-Location "E:\Programming\ebooker\apps\mobile"
npx expo run:android
