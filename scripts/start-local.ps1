param([switch]$NoBrowser,[switch]$Portable)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir = Join-Path $projectRoot '.runtime'
$dataDir = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Force -Path $runtimeDir, $dataDir | Out-Null
$ledgerPath = Join-Path $dataDir 'local-instance.json'
$localEntry = Join-Path $projectRoot 'src\local-service.js'
$sha = [Security.Cryptography.SHA256]::Create()
$mutexName = 'Local\TiboReset-' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot))).Replace('-','').Substring(0,16))
$mutex = New-Object Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) { Write-Host 'Another launcher is starting this project. Please wait.'; exit 0 }
try {
    if (Test-Path -LiteralPath $ledgerPath) {
        $ledger = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
        $running = Get-Process -Id $ledger.pid -ErrorAction SilentlyContinue
        if ($running -and $running.StartTime.ToUniversalTime().Ticks.ToString() -eq $ledger.startedTicks) {
            $health = Invoke-RestMethod -Uri ($ledger.url + '/api/health') -TimeoutSec 5
            if ($health.app -eq 'tibo-reset-live' -and $health.local) {
                Write-Host ('Already running: ' + $ledger.url)
                if (-not $NoBrowser) { Start-Process $ledger.url }
                exit 0
            }
            throw 'The recorded process is running but its health check failed. Use stop.cmd and retry.'
        }
    }
    $nodePath = $null
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    $candidates = @()
    if ($systemNode -and -not $Portable) { $candidates += $systemNode.Source }
    $candidates += @(Get-ChildItem -LiteralPath $runtimeDir -Directory | ForEach-Object { Join-Path $_.FullName 'node.exe' })
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $versionText = & $candidate --version
            $version = [Version] ($versionText -replace '^v','')
            if (($version.Major -eq 24 -and $version.Minor -ge 15) -or $version.Major -ge 26) { $nodePath = $candidate; break }
        }
    }
    if (-not $nodePath) {
        Write-Host 'Downloading a portable Node.js 24 runtime from nodejs.org (first launch only)...'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
        $manifest = (Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt').Content
        $package = [regex]::Match($manifest, '(?m)^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-win-' + $architecture + '\.zip)\s*$')
        if (-not $package.Success) { throw 'Unable to locate the official Node.js checksum.' }
        $archiveName = $package.Groups[2].Value
        $archivePath = Join-Path $runtimeDir $archiveName
        Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/latest-v24.x/' + $archiveName) -OutFile $archivePath
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.Groups[1].Value) { throw 'Runtime checksum mismatch. Launch cancelled.' }
        Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeDir -Force
        $nodePath = Join-Path (Join-Path $runtimeDir ([IO.Path]::GetFileNameWithoutExtension($archiveName))) 'node.exe'
    }
    $env:PATH = (Split-Path $nodePath) + ';' + $env:PATH
    $lockHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Algorithm SHA256).Hash
    $hashPath = Join-Path $runtimeDir 'dependencies.sha256'
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\node-notifier\package.json')) -or -not (Test-Path -LiteralPath $hashPath) -or (Get-Content -LiteralPath $hashPath -Raw).Trim() -ne $lockHash) {
        Write-Host 'Installing project dependencies (first launch or after an update)...'
        Push-Location $projectRoot
        try { & (Join-Path (Split-Path $nodePath) 'npm.cmd') ci --omit=dev --ignore-scripts; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your network and retry.' } }
        finally { Pop-Location }
        Set-Content -LiteralPath $hashPath -Value $lockHash -Encoding ASCII
    }
    # Reserve only a free loopback port. local.js sets the exact matching Origin.
    $port = 8788
    while ($port -lt 8809) {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
        try { $listener.Start(); $listener.Stop(); break } catch { $listener.Stop(); $port++ }
    }
    if ($port -ge 8809) { throw 'No free local port between 8788 and 8808.' }
    $env:PORT = $port.ToString()
    $url = 'http://localhost:' + $port
    $process = Start-Process -FilePath $nodePath -ArgumentList ('--env-file-if-exists=.env "' + $localEntry + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataDir 'local.stdout.log') -RedirectStandardError (Join-Path $dataDir 'local.stderr.log')
    @{ pid=$process.Id; root=$projectRoot; url=$url; startedTicks=$process.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
    $ready = $false
    $lastHealthError = 'No response received'
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw ('Background process exited. See ' + (Join-Path $dataDir 'local.stderr.log')) }
        try { $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/health') -TimeoutSec 3; if ($health.app -eq 'tibo-reset-live' -and $health.local) { $ready=$true; break }; $lastHealthError='Unexpected service response' } catch { $lastHealthError=$_.Exception.Message; Start-Sleep -Milliseconds 300 }
    }
    if (-not $ready) { throw ('Local service did not become ready: ' + $lastHealthError + '. Check data/local.stderr.log.') }
    Write-Host ('Running in background: ' + $url)
    Write-Host 'Close the calendar page freely. Use stop.cmd to stop monitoring.'
    if (-not $NoBrowser) { Start-Process $url }
} catch { Write-Error $_; exit 1 }
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
