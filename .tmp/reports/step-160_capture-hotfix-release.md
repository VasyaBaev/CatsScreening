# Step 160 — Capture hotfix release candidate

Дата: 2026-08-24

## Запрос / цель

Собрать проверенный release candidate из пяти фиксированных шагов, запушить его и подготовить exact-SHA deploy существующим Beget workflow.

## Понимание задачи

```text
RESULT: запушенный release candidate проходит полный gate и готов к развёртыванию exact SHA
IN SCOPE: полный typecheck/build, связанные API/browser smokes, diff/UTF-8/CRLF, минимальный deploy blocker fix, release report и push
OUT OF SCOPE: новый функционал, миграция legacy, новые зависимости и новая deploy-архитектура
MODE: predeploy
```

## План

1. Выполнить один полный typecheck/build gate.
2. Повторить связанный API lifecycle и browser smoke на временном storage.
3. Устранить только доказанный blocker существующего Beget script.
4. Проверить точный diff, кодировку, commit/push и совпадение local/remote SHA.

## Сделано

- Полный monorepo typecheck и production build прошли без runtime-изменений после шага 4.
- Release API-smoke повторно подтвердил task, locked source pH, reject/retry, raw uploads, exact bytes/SHA-256, ROI, resume, idempotent finalize, Admin exports и границу legacy.
- Browser-smoke подтвердил Mobile Capture, server task lookup/start, desktop Admin и ROI login/data pack.
- Сохранена production policy Playground: публичного route нет, pack и 96 assets остаются доступны для ROI.
- Доказанный deploy blocker устранён минимально: при отсутствии исключённых из remote-safe ветки raw Playground inputs скрипт использует committed verified pack; при наличии inputs по-прежнему пересобирает его.
- После `playground:build` и production build добавлена немедленная остановка deploy при ненулевом exit code.
- Исходная dirty-ветка `codex/production-like-capture-site` проверена read-only и осталась нетронутой.

## Изменённые файлы

- `deploy/beget/deploy.ps1`
- `.tmp/reports/step-160_capture-hotfix-release.md`

Runtime приложения в этом шаге не менялся.

## Команды / проверки

- `npm run typecheck` — успешно для shared, cv-core, API, Web и Vercel TypeScript-контура.
- `npm run build` — успешно; Vite production bundle: 52 modules.
- Fastify release smoke — HTTP health, PH613-RC1, reject→retry, 2 exact uploads, resume 2/2, ROI, double finalize и одна manifest row; legacy sentinel отсутствует в fresh Admin/exports.
- Browser `390×844` — `clientWidth=scrollWidth=375`, horizontal overflow отсутствует, controls ниже 44 px и inputs ниже 16 px отсутствуют.
- Browser task smoke — PH560-RCWEB вернул source pH 5.6 и specimen, attempt стартовал с двумя slots и server timer.
- Browser Admin — fresh source, 4 counters, 13 metadata/photo columns и exports отрисованы.
- Browser ROI — тестовый вход успешен, загружены 48 V5–V8 пар; fresh V9 endpoint отдельно прошёл API-smoke.
- Browser console — runtime errors отсутствуют; только существующие React Router future warnings и ожидаемый warning скрытого `/playground` route.
- PowerShell parser для `deploy/beget/deploy.ps1` — 0 ошибок.
- Deploy selection smoke на remote-safe checkout — выбран `committed-pack`: 48 пар, 12 feature options, 96 существующих assets, missing assets 0.
- `git diff --check`, UTF-8/CRLF и clean-tree/local-remote SHA — итоговая проверка перед commit/push.

## Риски / замечания

- Нативный mobile `capture` input не открыл системный file chooser в финальном in-app browser run. Upload не является непроверенным: exact bytes/SHA подтверждены release API-smoke, а полный browser file upload/reload/finalize E2E пройден в шаге 158.
- Raw Playground dataset намеренно не входит в remote-safe Git history; deploy использует уже закоммиченный pack. Сам генератор отдельно проверен на полной локальной read-only копии данных в шаге 159.
- Exact release commit SHA появляется после commit этого отчёта; deploy gate обязан сравнить local HEAD с `origin/codex/capture-hotfix-mobile-first`, а SHA фиксируется в deploy evidence и итоговом ответе.

## Результат

Release candidate прошёл полный gate и подготовлен к безопасному push/deploy существующим reversible Beget release/symlink механизмом без миграции legacy storage.
