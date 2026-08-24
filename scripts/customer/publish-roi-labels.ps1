$ErrorActionPreference = "Stop"

# Проверка, коммит и публикация ROI-разметки в GitHub.
# Скрипт коммитит только `data/dataset/roi-labels-v1.json`.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
Set-Location $repoRoot

$labelsPath = "data/dataset/roi-labels-v1.json"

if (-not (Test-Path $labelsPath)) {
  throw "Не найден файл $labelsPath. Сначала экспортируйте ROI JSON из /tools/roi-labeler."
}

Write-Host "Проверяю ROI-разметку..."
npm run roi:check

git add -- $labelsPath

$staged = git diff --cached --name-only -- $labelsPath
if (-not $staged) {
  Write-Host "Изменений в $labelsPath нет: коммит не нужен."
  exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "Add ROI labels ($timestamp)"
git push

Write-Host "ROI-разметка опубликована в GitHub."

