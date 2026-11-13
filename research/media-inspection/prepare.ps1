$ErrorActionPreference = 'Stop'
$env:GOMODCACHE = Join-Path $PSScriptRoot '.cache/modules'
$env:GOCACHE = Join-Path $PSScriptRoot '.cache/build'
$env:GOPATH = Join-Path $PSScriptRoot '.cache/gopath'
$env:GOTOOLCHAIN = 'go1.27.1'
$env:GOWORK = 'off'
Push-Location $PSScriptRoot
try {
    & go mod download -json gitlab.com/phpboyscout/afmpeg@v0.16.1
    if ($LASTEXITCODE -ne 0) { throw 'Could not acquire pinned afmpeg source.' }
} finally {
    Pop-Location
}
