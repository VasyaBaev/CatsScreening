# Step 159 — Admin новой capture-серии

Дата: 2026-08-24

## Запрос / цель

Показать в desktop Admin метаданные и фотографии новой capture-серии, не смешивая её с legacy, и сохранить работоспособность ROI labeling, Playground и Analyze.

## Понимание задачи

```text
RESULT: Admin показывает свежие кейсы, counters и exports, а ROI видит новые пары без поломки существующих desktop-инструментов
IN SCOPE: Admin API/UI, минимальный адаптер свежих кейсов для ROI и targeted проверки
OUT OF SCOPE: legacy compatibility/migration, desktop redesign, изменение Playground или Analyze
MODE: full
```

## План

1. Переключить Admin list/exports на отдельный `capture-hotfix/cases.jsonl`.
2. Показать task/specimen/pH/status/conditions/photos в существующей desktop-таблице.
3. Передать новые reference/diagnostic и blank reference/qc пары в существующий ROI flow.
4. Проверить API, UI builds и неизменённые Playground/Analyze.

## Сделано

- `/api/admin/cases`, CSV и JSONL читают только свежий manifest; legacy JSONL и Postgres не подмешиваются и не изменяются.
- Admin показывает total/included/excluded/Blank QC, task code/type, specimen, source/final pH, operator/device, условия, exclusion reason и ссылки на все сохранённые фото с размером и SHA-256.
- `/api/roi-labels/v9/cases` строит пары из свежих кейсов: `reference + diagnostic` для reacted specimen и `reference + qc` для blank.
- ROI получает source pH, band, сохранённые ROI, capture delta, operator/device и признак исключённого кейса.
- URL и формат существующих Admin exports, ROI auth/save flow, Playground page/pack и `/api/analyze` сохранены.

## Изменённые файлы

- `apps/api/src/routes/admin.ts`
- `apps/api/src/routes/roi-labels.ts`
- `apps/web/src/pages/AdminPage.tsx`
- `.tmp/reports/step-159_fresh-capture-admin.md`

## Команды / проверки

- `npm run typecheck --workspace @cats-screening/api` — успешно.
- `npm run typecheck --workspace @cats-screening/web` — успешно.
- `npm run build --workspace @cats-screening/api` — успешно.
- `npm run build --workspace @cats-screening/web` — успешно; Vite собрал 52 modules.
- Изолированный Fastify inject smoke — 2 свежих кейса, Admin list/CSV/JSONL, source/final pH, included/excluded, blank, public image URL, exact bytes/SHA-256 и ROI Basic Auth прошли.
- ROI smoke — 2 пары, включая `reference + qc` blank; сохранённые ROI и exclusion warning присутствуют.
- Реальный `/api/analyze` на существующей паре исходных фото — HTTP 200, числовые pH/score.
- Изолированная пересборка Playground вне рабочего дерева — 48 пар, 12 feature options, 96 непустых JPEG.
- Существующий pack проверен: 48 пар, 12 feature options, все image assets существуют и непусты.
- `git diff --check` и UTF-8/CRLF изменённых файлов — итоговый gate перед commit.

## Риски / замечания

- Новая серия намеренно пустая относительно legacy: старые кейсы не входят в новые counters/exports. Это утверждённая политика без миграции.
- ROI по свежим кейсам использует `sourcePh`; финальный pH остаётся отдельным полем Admin и не подменяет ground-truth исходного образца.
- Временные smoke-данные и пересобранный Playground находятся только в `%TEMP%`; project storage и `sources/` не изменялись.

## Результат

Desktop Admin и ROI работают с отдельной новой capture-серией, а существующие Playground и Analyze подтверждены проверками без изменения их кода или данных.
