# Step 157 — Capture task и binary upload hotfixes

Дата: 2026-08-24

## Запрос / цель

Добавить в старый Fastify/filesystem контур задания, resumable attempt, slots, исходный binary upload, ROI и идемпотентный finalize без новой архитектуры.

## Понимание задачи

Новая серия хранится отдельно от legacy внутри существующего `LOCAL_CAPTURE_STORAGE_DIR`. Неизвестные chemistry timings нельзя выдумывать.

## План

Расширить shared DTO, существующие cases/uploads routes и два локальных filesystem services, затем доказать exact bytes/hash и lifecycle через Fastify inject.

## Сделано

- Добавлены серверные коды известных локальных pH-точек: `PH400`…`PH780` и отдельный `BL613`; суффикс вроде `-A1` создаёт стабильный `specimenId` для одного физического образца на разных телефонах.
- `sourcePh` и task type приходят только с сервера; `finalMixturePh` хранится отдельно и остаётся `null` у `blank_qc`.
- Attempt фиксирует один `reactionStartedAt`, metadata оператора/устройства/серии/света/угла/дистанции и восстанавливается по id.
- Исходные bytes принимаются raw binary, сохраняются без Canvas/base64 преобразования вместе с фактическими `bytes`, `sha256`, content type, URI и normalized ROI.
- Required slots проверяются при finalize; повторный finalize возвращает тот же result и не дублирует новую строку manifest.
- Выбрана политика `fresh empty series`: `capture-hotfix/attempts`, `capture-hotfix/uploads`, `capture-hotfix/cases.jsonl`; legacy не читается и не смешивается.

## Изменённые файлы

- `packages/shared/src/index.ts`
- `apps/api/src/routes/cases.ts`
- `apps/api/src/routes/uploads.ts`
- `apps/api/src/services/local-capture-store.ts`
- `apps/api/src/services/local-image-storage.ts`
- `.tmp/reports/step-157_capture-task-and-upload-hotfixes.md`

## Команды (что запускалось)

- `npm ci`
- `npm run build --workspace packages/shared`
- `npm run build --workspace packages/cv-core`
- `npm run prisma:generate --workspace apps/api`
- `npm run typecheck --workspace apps/api`
- `npm run build --workspace apps/api`
- Fastify inject smoke: task/blank, missing slots, exact bytes/hash, failed upload + resume, ROI, double finalize, one manifest row
- `git diff --check`

## Риски / замечания

- Локальные требования не содержат target/tolerance реакции, поэтому значения не выдуманы: сервер фиксирует старт, клиент покажет честный elapsed time. Slots готовы принять target/tolerance, когда появится утверждённое значение.
- Neutral task codes — минимальная server-side конфигурация; UI управления worklist не добавлялся.
- `npm ci` сообщил существующие audit findings dependency tree; security redesign вне scope и для targeted build/smoke не потребовался.

## Результат

Server/API lifecycle новой серии работает на исходном filesystem storage: task lookup, resume, retry, original bytes/hash, ROI и идемпотентный finalize подтверждены smoke-проверкой.
