param([string]$AdrPath = (Join-Path $PSScriptRoot '../ADR'))

$ErrorActionPreference = 'Stop'
$records = @(Get-ChildItem -LiteralPath $AdrPath -File | Where-Object { $_.Name -match '^\d{4}-.+\.md$' } | Sort-Object Name)
if ($records.Count -eq 0) { throw 'No numbered ADRs found.' }
$indexPath = Join-Path $AdrPath 'README.md'
$index = Get-Content -LiteralPath $indexPath -Raw
$ids = @{}
$issues = [System.Collections.Generic.List[string]]::new()
$sections = @('Context', 'Decision', 'Alternatives', 'Consequences', 'Verification', 'Open questions')
$expectedId = 1
foreach ($record in $records) {
    $id = $record.Name.Substring(0, 4)
    if ([int]$id -ne $expectedId) { $issues.Add("$($record.Name): expected sequential ID $($expectedId.ToString('0000'))") }
    $expectedId++
    if ($ids.ContainsKey($id)) { $issues.Add("Duplicate ADR ID: $id") }
    $ids[$id] = $true
    $body = Get-Content -LiteralPath $record.FullName -Raw
    if ($body -notmatch "(?m)^# ADR-${id}: .+\r?`$") { $issues.Add("$($record.Name): missing matching title") }
    $statusMatch = [regex]::Match($body, '(?m)^Status: (Proposed|Accepted|Rejected|Superseded)\r?$')
    if (-not $statusMatch.Success) { $issues.Add("$($record.Name): invalid status") }
    if ($body -notmatch '(?m)^Date: \d{4}-\d{2}-\d{2}\r?$') { $issues.Add("$($record.Name): missing date") }
    if ($body -notmatch '(?m)^Decision owner: \S.+\r?$') { $issues.Add("$($record.Name): missing owner") }
    foreach ($section in $sections) {
        $sectionPattern = '(?ms)^## ' + [regex]::Escape($section) + '\r?\n\s*([^\s#].*?)(?=^## |\z)'
        if ($body -notmatch $sectionPattern) { $issues.Add("$($record.Name): missing or empty section $section") }
    }
    $indexRows = @($index -split '\r?\n' | Where-Object { $_.Contains("]($($record.Name))") })
    if ($indexRows.Count -ne 1) { $issues.Add("$($record.Name): must appear once in index") }
    elseif ($statusMatch.Success -and $indexRows[0] -notmatch ('\| ' + $statusMatch.Groups[1].Value + ' \|\s*$')) { $issues.Add("$($record.Name): index status mismatch") }
    if ($statusMatch.Groups[1].Value -eq 'Superseded' -and $body -notmatch '(?m)^Superseded by: \[ADR-\d{4}\]\(\d{4}-.+\.md\)\r?$') { $issues.Add("$($record.Name): missing superseding record link") }
}
foreach ($doc in Get-ChildItem -LiteralPath $AdrPath -File -Filter '*.md') {
    $body = Get-Content -LiteralPath $doc.FullName -Raw
    foreach ($link in [regex]::Matches($body, '\]\(([^)#]+\.md)(?:#[^)]*)?\)')) {
        $target = $link.Groups[1].Value
        if ($target -match '^https?://') { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $AdrPath $target))) { $issues.Add("$($doc.Name): broken local link $target") }
    }
}
if ($issues.Count -gt 0) { throw ($issues -join "`n") }
Write-Output "Validated $($records.Count) ADRs and their index. Architectural compliance and user approval require review."
