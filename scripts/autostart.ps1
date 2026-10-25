param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcher = Join-Path $PSScriptRoot 'start-local.ps1'
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Tibo Reset Calendar.lnk'
$shell = New-Object -ComObject WScript.Shell
if ($Disable) {
    if (Test-Path -LiteralPath $shortcutPath) {
        $existing = $shell.CreateShortcut($shortcutPath)
        if (-not $existing.Arguments.Contains($launcher)) { throw 'Shortcut belongs to another copy. Nothing was removed.' }
        Remove-Item -LiteralPath $shortcutPath
    }
    Write-Host 'Start at sign-in disabled. Current monitoring is unchanged.'
} else {
    if (Test-Path -LiteralPath $shortcutPath) {
        $existing = $shell.CreateShortcut($shortcutPath)
        if (-not $existing.Arguments.Contains($launcher)) { throw 'A different copy already owns the shortcut. Disable it there first.' }
    }
    # 只持久化解析后的数据目录；登录后不依赖临时终端变量，也不复制凭证。
    $candidates = @()
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) { $candidates += $systemNode.Source }
    $runtimeDir = Join-Path $projectRoot '.runtime'
    if (Test-Path -LiteralPath $runtimeDir) { $candidates += @(Get-ChildItem -LiteralPath $runtimeDir -Directory | ForEach-Object { Join-Path $_.FullName 'node.exe' }) }
    $remembered = $false
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            & $candidate (Join-Path $PSScriptRoot 'local-control.mjs') remember-data-dir
            if ($LASTEXITCODE -ne 0) { throw 'Could not preserve the local data directory. Autostart was not changed.' }
            $remembered = $true
            break
        }
    }
    if (-not $remembered) { throw 'Start the calendar once to prepare Node.js before enabling autostart.' }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
    $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -NoBrowser'
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Host 'Enabled start at Windows sign-in. Keep this project folder in place.'
}
