param(
  [string]$HostName = "155.212.128.62",
  [string]$User = "root",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\cats_screening_beget_ed25519"
)

$ErrorActionPreference = "Stop"

# Деплой под Beget VPS.
#
# Что делает:
# - пересобирает Playground pack и production build локально;
# - упаковывает только runtime-часть проекта;
# - отправляет архив на сервер;
# - раскладывает release в /opt/cats-screening/current;
# - ставит production dependencies и перезапускает systemd service.

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$release = Get-Date -Format "yyyyMMddHHmmss"
$deployRoot = Join-Path $root ".tmp\deploy"
$stage = Join-Path $deployRoot "cats-screening-$release"
$archive = Join-Path $deployRoot "cats-screening-$release.tar.gz"
$remote = "$User@$HostName"
$sshBase = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new")
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

Set-Location $root

npm run playground:build
npm run build

if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$copyItems = @(
  "package.json",
  "package-lock.json",
  "apps/api/package.json",
  "apps/api/dist",
  "apps/api/prisma",
  "apps/web/package.json",
  "apps/web/dist",
  "packages/shared/package.json",
  "packages/shared/dist",
  "packages/cv-core/package.json",
  "packages/cv-core/dist",
  "data/models",
  "deploy/beget"
)

foreach ($item in $copyItems) {
  $source = Join-Path $root $item
  $target = Join-Path $stage $item
  $targetParent = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

if (Test-Path $archive) {
  Remove-Item -LiteralPath $archive -Force
}

tar -czf $archive -C $stage .

scp @sshBase $archive "${remote}:/tmp/cats-screening-release.tar.gz"
scp @sshBase (Join-Path $root "deploy\beget\cats-screening.service") "${remote}:/tmp/cats-screening.service"
scp @sshBase (Join-Path $root "deploy\beget\nginx-http.conf") "${remote}:/tmp/cats-screening-nginx.conf"

# Репозиторий хранит текстовые файлы в CRLF, но Linux shell-скрипт на VPS должен
# запускаться с LF. Поэтому для upload создаём временную LF-копию и запускаем её
# через `bash`, чтобы shebang не зависел от Windows-переносов строк.
$setupServerSource = Join-Path $root "deploy\beget\setup-server.sh"
$setupServerUpload = Join-Path $deployRoot "setup-server-$release.sh"
$setupServerText = [System.IO.File]::ReadAllText($setupServerSource) -replace "`r?`n", "`n"
[System.IO.File]::WriteAllText($setupServerUpload, $setupServerText, $utf8NoBom)
scp @sshBase $setupServerUpload "${remote}:/tmp/cats-screening-setup-server.sh"
ssh @sshBase $remote "bash /tmp/cats-screening-setup-server.sh"

$remoteScript = @"
set -euo pipefail
release="/opt/cats-screening/releases/$release"
mkdir -p "`$release"
tar -xzf /tmp/cats-screening-release.tar.gz -C "`$release"
cd "`$release"
npm ci --omit=dev
chown -R root:root "`$release"
ln -sfn "`$release" /opt/cats-screening/current
chown -R catscreen:catscreen /var/lib/cats-screening/storage
systemctl restart cats-screening.service
systemctl reload nginx
systemctl --no-pager --full status cats-screening.service
"@

$remoteScriptPath = Join-Path $deployRoot "remote-deploy-$release.sh"
[System.IO.File]::WriteAllText($remoteScriptPath, ($remoteScript -replace "`r?`n", "`n"), $utf8NoBom)
scp @sshBase $remoteScriptPath "${remote}:/tmp/cats-screening-remote-deploy.sh"
ssh @sshBase $remote "bash /tmp/cats-screening-remote-deploy.sh"

Write-Output "Deployed CatsScreening release $release to $HostName"
