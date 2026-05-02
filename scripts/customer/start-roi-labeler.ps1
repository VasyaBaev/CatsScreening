$ErrorActionPreference = "Stop"

# Запуск локальной оснастки ROI-разметки для заказчика.
# Скрипт выполняется из любой папки внутри репозитория.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
Set-Location $repoRoot

Write-Host "CatsScreening ROI labeler"
Write-Host "Repo: $repoRoot"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js не найден. Установите Node.js 20+ с https://nodejs.org/"
}

if (-not (Test-Path "node_modules")) {
  Write-Host "node_modules не найден: запускаю npm install..."
  npm install
}

$url = "http://127.0.0.1:5173/tools/roi-labeler"
Write-Host "Откроется страница: $url"
Start-Process $url

npm run dev:web -- --host 127.0.0.1

