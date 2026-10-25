param([switch]$NoBrowser,[switch]$Portable)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$mutexName = 'Local\TiboResetLiveLauncher'
$mutex = New-Object Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) { Write-Host 'Another launcher is starting this project. Please wait.'; exit 0 }
try {
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
    # All platforms share the same launcher, migration and stop protocol.
    $controlArgs = @((Join-Path $PSScriptRoot 'local-control.mjs'), 'start')
    if ($NoBrowser) { $controlArgs += '--no-browser' }
    & $nodePath @controlArgs
    if ($LASTEXITCODE -ne 0) { throw 'Local service did not start. See the message above.' }
} catch { Write-Error $_; exit 1 }
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
