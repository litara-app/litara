$ErrorActionPreference = 'Stop'
$env:GOMODCACHE = Join-Path $PSScriptRoot '.cache/modules'
$env:GOCACHE = Join-Path $PSScriptRoot '.cache/build'
$env:GOPATH = Join-Path $PSScriptRoot '.cache/gopath'
$env:GOTOOLCHAIN = 'go1.27.1'
$env:GOWORK = 'off'
$env:CGO_ENABLED = '0'
Push-Location $PSScriptRoot
try {
    & go mod tidy
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve research dependencies.' }
    & go fmt ./...
    if ($LASTEXITCODE -ne 0) { throw 'Research formatting failed.' }
    & go run .
    if ($LASTEXITCODE -ne 0) { throw 'Media inspection experiment failed; see output.' }
} finally {
    Pop-Location
}
