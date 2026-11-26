$ErrorActionPreference = 'Stop'
$root = Join-Path $PWD 'desktop-public-diagnostics'
New-Item -ItemType Directory -Path $root -Force | Out-Null
$baseline = if ($env:MESA_PUBLIC_BASELINE) { $env:MESA_PUBLIC_BASELINE } else { '2.0.8' }
$baselinePattern = [regex]::Escape($baseline)
$version = node -p "require('./desktop/package.json').version"
if ([version]$version -le [version]$baseline) { throw "Expected a newer version than $baseline" }
$repo = 'https://github.com/kloreto77/claw-empire'
$old = Join-Path $root "Mesa-V2-Setup-$baseline-x64.exe"
$install = Join-Path $env:LOCALAPPDATA 'MesaV2-Public-CI'
$exe = Join-Path $install 'MesaOperacoesV2.exe'
$asar = Join-Path $install 'resources/app.asar'
$expectedHash = (Get-Content 'desktop-release/app-asar.sha256' -Raw).Trim()
$latest = Join-Path $root 'latest.yml'
$runtime = $null
$p = $null

function Read-Log($file) {
  if (Test-Path $file) { return (Get-Content $file -Raw) }
  return ''
}

function Wait-For([scriptblock]$condition, [int]$seconds, [string]$message) {
  for ($i=0; $i -lt $seconds; $i++) {
    if (& $condition) { return }
    Start-Sleep -Seconds 1
  }
  throw $message
}

function Start-Mesa([string]$label) {
  Start-Process -FilePath $exe -PassThru -RedirectStandardOutput (Join-Path $root "$label.stdout.log") -RedirectStandardError (Join-Path $root "$label.stderr.log")
}

function Close-Mesa($process) {
  $process.Refresh()
  if ($process.HasExited) { throw 'Application exited before normal close' }
  if (!$process.CloseMainWindow()) { throw 'Unable to request normal window close' }
  if (!$process.WaitForExit(120000)) { throw 'Application did not close gracefully' }
  if ($process.ExitCode -ne 0) { throw "Application exit code: $($process.ExitCode)" }
}

try {
  # Public HTTPS endpoints only. No token or feed override is supplied to the app.
  curl.exe --fail --location --retry 4 "$repo/releases/download/v$baseline/Mesa-V2-Setup-$baseline-x64.exe" --output $old
  if ($LASTEXITCODE -ne 0) { throw 'Public baseline installer download failed' }
  curl.exe --fail --location --retry 4 "$repo/releases/download/v$baseline/latest.yml" --output (Join-Path $root 'baseline.yml')
  if ($LASTEXITCODE -ne 0) { throw 'Public baseline metadata download failed' }
  $oldMeta = Get-Content (Join-Path $root 'baseline.yml') -Raw
  $expectedOld = [regex]::Match($oldMeta,'(?m)^sha512:\s*(\S+)\s*$').Groups[1].Value
  $actualOld = [Convert]::ToBase64String([Convert]::FromHexString((Get-FileHash $old -Algorithm SHA512).Hash))
  if (!$expectedOld -or $actualOld -ne $expectedOld) { throw 'Baseline installer checksum mismatch' }
  Wait-For {
    curl.exe --silent --fail --location "$repo/releases/latest/download/latest.yml" --output $latest
    ($LASTEXITCODE -eq 0) -and ((Read-Log $latest) -match "(?m)^version:\s*$([regex]::Escape($version))\s*$")
  } 90 'Public release feed does not advertise expected version'
  $newMeta = Get-Content $latest -Raw
  if ($newMeta -notmatch "Mesa-V2-Setup-$([regex]::Escape($version))-x64.exe") { throw 'Unexpected public installer metadata' }
  $setup = Start-Process -FilePath $old -ArgumentList "/S /D=$install" -PassThru
  if (!$setup.WaitForExit(600000)) { Stop-Process -Id $setup.Id -Force; throw 'Public baseline install timed out' }
  if ($setup.ExitCode -ne 0 -or !(Test-Path $exe)) { throw 'Public baseline installation failed' }
  if ((Get-FileHash $asar -Algorithm SHA256).Hash -eq $expectedHash) { throw 'Baseline unexpectedly equals target' }

  # Launch exactly as a user would, with a normal visible window and default GitHub feed.
  Remove-Item Env:MESA_UPDATE_TEST_FEED,Env:MESA_SMOKE_DIR -ErrorAction SilentlyContinue
  $env:ELECTRON_ENABLE_LOGGING = '1'
  $p = Start-Mesa 'before'
  $runtime = $null
  for ($i=0; $i -lt 120 -and !$runtime; $i++) {
    $p.Refresh()
    if ($p.HasExited) { throw "Baseline exited early: $($p.ExitCode)" }
    foreach ($dir in (Get-ChildItem $env:APPDATA -Directory)) {
      $candidate = Join-Path $dir.FullName 'runtime'
      $log = Join-Path $candidate 'logs/desktop-main.log'
      if ((Read-Log $log) -match "Desktop main started: $baselinePattern") { $runtime = $candidate; break }
    }
    if (!$runtime) { Start-Sleep -Seconds 1 }
  }
  if (!$runtime) { throw 'Cannot locate normal user profile' }
  $log = Join-Path $runtime 'logs/desktop-main.log'
  Wait-For { (Read-Log $log) -match 'Desktop page loaded' } 120 'Baseline UI did not load'
  Wait-For { $p.Refresh(); !$p.HasExited -and $p.MainWindowHandle -ne 0 } 30 'Normal window not found'
  $db = Join-Path $runtime 'mesa.sqlite'
  $key = Join-Path $runtime 'encryption-key.txt'
  $keyHash = (Get-FileHash $key -Algorithm SHA256).Hash
  $env:MESA_TEST_DB = $db
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.MESA_TEST_DB);db.exec('PRAGMA busy_timeout=10000;CREATE TABLE IF NOT EXISTS desktop_public_update_test(value TEXT)');db.prepare('INSERT INTO desktop_public_update_test VALUES (?)').run('preserved');db.close()"
  if ($LASTEXITCODE -ne 0) { throw 'Cannot write public update persistence marker' }
  Wait-For { (Read-Log $log) -match 'Update ready; waiting for clean idle shutdown' } 600 'App did not download update from public GitHub feed'
  Close-Mesa $p
  Wait-For {
    try { (Get-FileHash $asar -Algorithm SHA256).Hash -eq $expectedHash } catch { $false }
  } 600 'Public updater did not install expected application fingerprint'
  Wait-For {
    !(Get-Process | Where-Object { $_.ProcessName -like 'Mesa-V2-Setup*' -or $_.ProcessName -eq 'installer' })
  } 300 'Public update installer did not finish'
  Start-Sleep -Seconds 5
  $p = Start-Mesa 'after'
  Wait-For { (Read-Log $log) -match "Desktop main started: $([regex]::Escape($version))" } 120 'Updated production app did not open'
  Wait-For {
    $content = Read-Log $log
    $index = $content.LastIndexOf("Desktop main started: $version")
    $index -ge 0 -and $content.Substring($index).Contains('Desktop page loaded')
  } 120 'Updated UI did not load'
  Wait-For { $p.Refresh(); !$p.HasExited -and $p.MainWindowHandle -ne 0 } 30 'Updated window not found'
  Close-Mesa $p
  if ((Get-FileHash $key -Algorithm SHA256).Hash -ne $keyHash) { throw 'Encryption key changed' }
  if ((Read-Log $log) -notmatch 'Pre-update backup completed') { throw 'No backup confirmation' }
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.MESA_TEST_DB);if(db.prepare('SELECT value FROM desktop_public_update_test').get()?.value!=='preserved')process.exitCode=1;db.close()"
  if ($LASTEXITCODE -ne 0) { throw 'Database marker missing after public upgrade' }
  $backup = Get-ChildItem (Join-Path $runtime 'update-backups') -Directory | Select-Object -First 1
  if (!$backup -or !(Test-Path (Join-Path $backup.FullName 'mesa.sqlite'))) { throw 'Pre-update database backup missing' }
  if ((Get-FileHash (Join-Path $backup.FullName 'encryption-key.txt') -Algorithm SHA256).Hash -ne $keyHash) { throw 'Backup key mismatch' }
  Write-Host "PUBLIC GITHUB UPDATE PASSED: $baseline -> $version; normal window, exact application fingerprint, database, encryption key and backup verified."
} finally {
  if ($p -and !$p.HasExited) { Stop-Process -Id $p.Id -Force }
  if ($runtime -and (Test-Path (Join-Path $runtime 'logs'))) {
    Copy-Item (Join-Path $runtime 'logs') (Join-Path $root 'runtime-logs') -Recurse -Force
  }
  Get-ChildItem $root -Filter '*.log' -Recurse | ForEach-Object {
    Write-Host "=== $($_.Name) ==="
    Get-Content $_.FullName -Tail 80
  }
  # Do not upload the downloaded installer or any database/key files.
  Remove-Item $old -Force -ErrorAction SilentlyContinue
}
