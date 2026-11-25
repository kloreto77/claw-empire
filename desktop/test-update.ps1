$ErrorActionPreference = 'Stop'
$root = Join-Path $PWD 'desktop-diagnostics/update-test'
$installDir = Join-Path $env:LOCALAPPDATA 'MesaV2-CI-Install'
$profile = Join-Path $root 'profile'
$fixture = Join-Path $PWD 'desktop-update-fixture/Mesa-V2-Setup-2.0.0-x64.exe'
$release = Join-Path $PWD 'desktop-release'
$expectedAsar = Join-Path $release 'win-unpacked/resources/app.asar'
$exe = Join-Path $installDir 'MesaOperacoesV2.exe'
$asar = Join-Path $installDir 'resources/app.asar'
$env:MESA_SMOKE_DIR = $profile
$env:ELECTRON_ENABLE_LOGGING = '1'
New-Item -ItemType Directory -Path $root,$profile -Force | Out-Null
$version = node -p "require('./desktop/package.json').version"
if (!(Test-Path $fixture)) { throw 'Earlier installer missing' }

function Run-App([string]$label, [string[]]$flags, [int]$timeout) {
  $p = Start-Process -FilePath $exe -ArgumentList $flags -PassThru -RedirectStandardOutput (Join-Path $root "$label.stdout.log") -RedirectStandardError (Join-Path $root "$label.stderr.log")
  if (!$p.WaitForExit($timeout)) {
    Stop-Process -Id $p.Id -Force
    throw "App timed out: $label"
  }
  if ($p.ExitCode -ne 0) { throw "App failed: $label ($($p.ExitCode))" }
}

$server = $null
try {
  $setup = Start-Process -FilePath $fixture -ArgumentList "/S /D=$installDir" -PassThru
  for ($i=0; $i -lt 20 -and !$setup.HasExited; $i++) {
    $null = $setup.WaitForExit(30000)
    $setup.Refresh()
    if (!$setup.HasExited) {
      Write-Host "Installation in progress: $((($i+1)*30)) seconds"
      Get-Process -Id $setup.Id -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,CPU,WorkingSet | Format-Table
    }
  }
  if (!$setup.HasExited) {
    Get-Process | Where-Object { $_.ProcessName -match 'Mesa|Setup|nsis' } | Select-Object Id,ProcessName,CPU | Format-Table
    if (Test-Path $installDir) { Get-ChildItem $installDir | Select-Object Name,Length | Format-Table }
    Stop-Process -Id $setup.Id -Force
    throw 'Installer timed out after ten minutes'
  }
  if ($setup.ExitCode -ne 0 -or !(Test-Path $exe)) { throw 'Installer failed' }
  Run-App 'before' @('--mesa-smoke-test') 120000
  $db = Join-Path $profile 'smoke-runtime/mesa.sqlite'
  $key = Join-Path $profile 'smoke-runtime/encryption-key.txt'
  $keyHash = (Get-FileHash $key -Algorithm SHA256).Hash
  $env:MESA_TEST_DB = $db
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.MESA_TEST_DB);db.exec('CREATE TABLE IF NOT EXISTS desktop_update_test(value TEXT);DELETE FROM desktop_update_test');db.prepare('INSERT INTO desktop_update_test VALUES (?)').run('preserved');db.close()"
  if ($LASTEXITCODE -ne 0) { throw 'Cannot seed update persistence marker' }
  $baselineHash = (Get-FileHash $asar -Algorithm SHA256).Hash
  $expectedHash = (Get-FileHash $expectedAsar -Algorithm SHA256).Hash
  if ($baselineHash -eq $expectedHash) { throw 'Fixture must have a different version' }
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  $server = Start-Process -FilePath python -WorkingDirectory $release -ArgumentList @('-m','http.server',"$port",'--bind','127.0.0.1') -PassThru -RedirectStandardOutput (Join-Path $root 'feed.stdout.log') -RedirectStandardError (Join-Path $root 'feed.stderr.log')
  $env:MESA_UPDATE_TEST_FEED = "http://127.0.0.1:$port/"
  $feedReady = $false
  for ($i=0; $i -lt 30; $i++) {
    try { $null = Invoke-WebRequest ($env:MESA_UPDATE_TEST_FEED+'latest.yml') -TimeoutSec 2; $feedReady = $true; break } catch { Start-Sleep -Seconds 1 }
  }
  if (!$feedReady) { throw 'Update feed unavailable' }
  Run-App 'update' @('--mesa-smoke-test','--mesa-update-test') 300000
  $installed = $false
  for ($i=0; $i -lt 600; $i++) {
    try { if ((Get-FileHash $asar -Algorithm SHA256).Hash -eq $expectedHash) { $installed = $true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (!$installed) { throw 'Updated application was not installed' }
  # The ASAR may be copied before the installer finishes extracting the backend.
  for ($i=0; $i -lt 300; $i++) {
    $setupProcesses = Get-Process | Where-Object { $_.ProcessName -like 'Mesa-V2-Setup*' }
    if (!$setupProcesses) { break }
    Start-Sleep -Seconds 1
  }
  if ($setupProcesses) { throw 'Update installer did not finish' }
  Start-Sleep -Seconds 5
  Run-App 'after' @('--mesa-smoke-test') 120000
  $log = Join-Path $profile 'smoke-runtime/logs/desktop-main.log'
  if (!(Select-String -Path $log -Pattern "Desktop main started: $version" -SimpleMatch)) { throw 'New version did not open' }
  if (!(Select-String -Path $log -Pattern 'Pre-update backup completed.' -SimpleMatch)) { throw 'Backup not created' }
  if ((Get-FileHash $key -Algorithm SHA256).Hash -ne $keyHash) { throw 'Encryption key changed' }
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.MESA_TEST_DB);if(db.prepare('SELECT value FROM desktop_update_test').get()?.value!=='preserved')process.exitCode=1;db.close()"
  if ($LASTEXITCODE -ne 0) { throw 'Database marker was not preserved' }
  Write-Host 'Installer, automatic upgrade, database, and encryption key verified.'
} finally {
  if ($server -and !$server.HasExited) { Stop-Process -Id $server.Id -Force }
  Get-ChildItem $root -Filter '*.log' -Recurse | ForEach-Object { Write-Host "=== $($_.Name) ==="; Get-Content $_.FullName -Tail 60 }
}
