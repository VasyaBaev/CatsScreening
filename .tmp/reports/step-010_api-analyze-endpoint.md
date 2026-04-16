# Step 010 — API: `/api/analyze` (dev)
Дата: 2026-04-16

## Запрос / цель
Реализовать Step-010 из плана: добавить endpoint, который принимает `reference+diagnostic+roiRect` и возвращает результат анализа (`pH_estimate/score/confidence` + QC).

## Понимание задачи
- Для быстрой итерации по пайплайну нужен простой “инженерный” endpoint.
- В MVP (dev) достаточно читать изображения по локальным путям внутри репозитория.
- В проде чтение будет из object storage или через upload, поэтому текущая реализация помечена как dev.

## План
1) Добавить ROI schema в `@cats-screening/shared` и `AnalyzeRequestSchema`.
2) Добавить Node утилиты в `apps/api/src/cv`:
   - поиск repo root,
   - безопасное разрешение путей,
   - декодирование через `sharp`,
   - загрузка calibration model с кешированием.
3) Добавить маршрут `POST /api/analyze`.
4) Обновить документацию endpoints.
5) Прогнать typecheck.

## Сделано
- Добавлено:
  - `packages/shared/src/index.ts`: `RoiRectSchema`, `AnalyzeRequestSchema`.
  - `apps/api/src/cv/repo-root.ts`: поиск корня monorepo.
  - `apps/api/src/cv/image-io.ts`: чтение/rotate/resize через `sharp` + safe path.
  - `apps/api/src/cv/calibration.ts`: загрузка `data/models/calibration-v0.json` с кешированием.
  - `apps/api/src/routes/analyze.ts`: `POST /api/analyze`.
- Подключён маршрут в `apps/api/src/routes/index.ts`.
- Обновлён `docs/api/endpoints.md` с примером PowerShell.

## Изменённые файлы
- `packages/shared/src/index.ts`
- `apps/api/src/cv/repo-root.ts`
- `apps/api/src/cv/image-io.ts`
- `apps/api/src/cv/calibration.ts`
- `apps/api/src/routes/analyze.ts`
- `apps/api/src/routes/index.ts`
- `docs/api/endpoints.md`
- `.tmp/reports/step-010_api-analyze-endpoint.md`

## Команды (что запускалось)
```powershell
npm run build --workspace packages/shared
npm run build --workspace packages/cv-core
npm run typecheck --workspace apps/api
npm run typecheck --workspace apps/web
```

## Риски / замечания
- `/api/analyze` пока DEV‑эндпоинт: читает локальные файлы по путям и ожидает локальную калибровку.
- Для работы эндпоинта нужно собрать модель `data/models/calibration-v0.json` (требует ROI‑разметки).
- `sharp` — нативная зависимость, в CI/деплое может потребовать внимания (но обычно работает на Vercel).

## Следующие шаги
1) Разметить ROI → `npm run pipeline:calibrate` → `npm run pipeline:eval`.
2) Затем можно подключить анализ в `POST /api/cases` и в пользовательский флоу (upload + результат).

