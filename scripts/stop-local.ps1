$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ledgerPath = Join-Path $projectRoot 'data\local-instance.json'
if (-not (Test-Path -LiteralPath $ledgerPath)) { Write-Host 'No local background process recorded.'; exit 0 }
$ledger = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
if ($ledger.root -ne $projectRoot) { throw 'Recorded workspace does not match this project. Nothing was stopped.' }
$process = Get-Process -Id $ledger.pid -ErrorAction SilentlyContinue
if ($process) {
    $info = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ledger.pid)
    # 更新代码时也能停止重构前仍在运行的实例。
    $entries = @((Join-Path $projectRoot 'src\local.js'), (Join-Path $projectRoot 'local.js'))
    $supervisors = @((Join-Path $projectRoot 'src\local-service.js'), (Join-Path $projectRoot 'local-service.js'))
    $isWorker = @($entries | Where-Object { $info.CommandLine.Contains($_) }).Count -gt 0
    $isSupervisor = @($supervisors | Where-Object { $info.CommandLine.Contains($_) }).Count -gt 0
    if ($process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $ledger.startedTicks -or (-not $isWorker -and -not $isSupervisor)) { throw 'Process identity does not match. Nothing was stopped.' }
    $children = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $ledger.pid) | Where-Object { $candidate=$_; $candidate.Name -eq 'node.exe' -and @($entries | Where-Object { $candidate.CommandLine.Contains($_) }).Count -gt 0 })
    if ($isSupervisor) {
        $service = Get-Content -LiteralPath (Join-Path $projectRoot 'data\local-service.json') -Raw | ConvertFrom-Json
        if ($service.supervisorPid -ne $ledger.pid -or -not $service.token) { throw 'Supervisor identity does not match. The process ledger was preserved.' }
        @{supervisorPid=[int]$ledger.pid; token=$service.token} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'data\local-stop.json') -Encoding UTF8
    } else {
        # 兼容旧版本的直接启动进程；新版本由守护自己停止子进程并退出。
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
