$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataDir = if ($env:TIBO_DATA_DIR) { if ([IO.Path]::IsPathRooted($env:TIBO_DATA_DIR)) { [IO.Path]::GetFullPath($env:TIBO_DATA_DIR) } else { [IO.Path]::GetFullPath((Join-Path $projectRoot $env:TIBO_DATA_DIR)) } } elseif ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'TiboResetLive' } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData\Local\TiboResetLive' }
$ledgerPath = Join-Path $dataDir 'local-instance.json'
$legacyLedgerPath = Join-Path $projectRoot 'data\local-instance.json'
if (-not (Test-Path -LiteralPath $ledgerPath) -and $legacyLedgerPath -ne $ledgerPath -and (Test-Path -LiteralPath $legacyLedgerPath)) {
    $ledgerPath = $legacyLedgerPath
    $dataDir = Split-Path $legacyLedgerPath
}
$ledger = if (Test-Path -LiteralPath $ledgerPath) { Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json } else { $null }
if (-not $ledger -or -not $ledger.startedTicks) {
    $candidates = @()
    if ($ledger -and $ledger.nodePath) { $candidates += $ledger.nodePath }
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) { $candidates += $systemNode.Source }
    $runtimeDir = Join-Path $projectRoot '.runtime'
    if (Test-Path -LiteralPath $runtimeDir) { $candidates += @(Get-ChildItem -LiteralPath $runtimeDir -Directory | ForEach-Object { Join-Path $_.FullName 'node.exe' }) }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            & $candidate (Join-Path $PSScriptRoot 'local-control.mjs') stop
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop the background. Its process record was preserved.' }
            exit 0
        }
    }
    if (-not $ledger) { Write-Host 'No local background process recorded.'; exit 0 }
    throw 'Node.js was not found. Restore the runtime or install Node.js before stopping.'
}
# Legacy Windows instances only; new instances use the shared Node controller.
if ($ledger.root -ne $projectRoot) { throw 'Recorded workspace does not match this project. Nothing was stopped.' }
$process = Get-Process -Id $ledger.pid -ErrorAction SilentlyContinue
if ($process) {
    $info = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ledger.pid)
    # Keep compatibility with instances launched before the directory refactor.
    $entries = @((Join-Path $projectRoot 'src\local.js'), (Join-Path $projectRoot 'local.js'))
    $supervisors = @((Join-Path $projectRoot 'src\local-service.js'), (Join-Path $projectRoot 'local-service.js'))
    $isWorker = @($entries | Where-Object { $info.CommandLine.Contains($_) }).Count -gt 0
    $isSupervisor = @($supervisors | Where-Object { $info.CommandLine.Contains($_) }).Count -gt 0
    if ($process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $ledger.startedTicks -or (-not $isWorker -and -not $isSupervisor)) { throw 'Process identity does not match. Nothing was stopped.' }
    $children = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $ledger.pid) | Where-Object { $candidate=$_; $candidate.Name -eq 'node.exe' -and @($entries | Where-Object { $candidate.CommandLine.Contains($_) }).Count -gt 0 })
    if ($isSupervisor) {
        $service = Get-Content -LiteralPath (Join-Path $dataDir 'local-service.json') -Raw | ConvertFrom-Json
        if ($service.supervisorPid -ne $ledger.pid -or -not $service.token) { throw 'Supervisor identity does not match. The process ledger was preserved.' }
        @{supervisorPid=[int]$ledger.pid; token=$service.token} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataDir 'local-stop.json') -Encoding UTF8
    } else {
        # Old direct workers have no supervisor to accept a stop request.
        Stop-Process -Id ([int]$ledger.pid) -Force
    }
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        $remaining=Get-Process -Id ([int]$ledger.pid) -ErrorAction SilentlyContinue
        if (-not $remaining -or $remaining.StartTime.ToUniversalTime().Ticks.ToString() -ne $ledger.startedTicks) { break }
        Start-Sleep -Milliseconds 250
    }
    if ($remaining -and $remaining.StartTime.ToUniversalTime().Ticks.ToString() -eq $ledger.startedTicks) { throw 'Background process did not stop. The process ledger was preserved.' }
    foreach ($child in $children) {
        $remainingChild=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $child.ProcessId)
        if ($remainingChild -and $remainingChild.CreationDate -eq $child.CreationDate -and $remainingChild.CommandLine -eq $child.CommandLine) { throw 'A worker is still stopping. The process ledger was preserved; retry shortly.' }
    }
}
# Remove only this project's process ledger, never its data or subscriptions.
Remove-Item -LiteralPath $ledgerPath
Write-Host 'Local monitoring stopped. Your calendar and preferences are preserved.'
