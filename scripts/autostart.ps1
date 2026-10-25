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
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
    $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -NoBrowser'
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Host 'Enabled start at Windows sign-in. Keep this project folder in place.'
}
