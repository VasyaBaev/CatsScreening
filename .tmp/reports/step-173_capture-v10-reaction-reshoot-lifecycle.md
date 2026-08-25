# Step 173 — Capture V10 reaction and reshoot lifecycle

Дата: 2026-08-25

## Запрос / цель

Реализовать честный staged lifecycle, restart/reshoot history и минимальную защиту quota/specimen
transitions от гонок в одном Node process.

## Понимание задачи

Реакция начинается отдельным server action только после сохранённого reference с валидным ROI.
Файлы старых attempts не удаляются, а короткий lock не охватывает передачу upload bytes.

## План

Расширить attempt lifecycle contract, сериализовать только filesystem state transitions,
добавить reaction/replacement endpoints и проверить timing, history и concurrency.

## Сделано

- новые attempts получают `reactionStartedAt = null`;
- idempotent reaction start требует reference upload и policy-required polygon ROI;
- diagnostic upload до старта реакции возвращает conflict;
- persisted `diagnosticSavedAt` и `reactionElapsedSec` считаются по server timestamps;
- active restart переводит старую attempt в `abandoned`, finalized reshoot — в `superseded`;
- old/new attempts связаны replacement IDs, same/new specimen создаётся без ручного ID;
- quota учитывает только active reservations и current finalized included attempts;
- короткая process-local promise critical section защищает reserve/finalize/replacement/updates;
- attempts и JSONL manifest записываются через atomic rename; original files не удаляются;
- finalize требует ROI/polygon по policy и сохраняет idempotent excluded result.

## Изменённые файлы

- `packages/shared/src/index.ts`;
- `apps/api/src/routes/cases.ts`;
- `apps/api/src/routes/uploads.ts`;
- `apps/api/src/services/local-capture-store.ts`;
- `apps/api/src/services/capture-lifecycle.test.ts`.

## Команды (что запускалось)

- `npm run build --workspace packages/shared`;
- `npm run typecheck --workspace apps/api`;
- `node --import tsx --test apps/api/src/services/capture-policy.test.ts` — 7/7 passed;
- `node --import tsx --test apps/api/src/services/capture-lifecycle.test.ts` — 8/8 passed;
- targeted `prettier --check`;
- targeted `git diff --check`.

## Риски / замечания

Critical section действует только внутри одного Node process, как утверждено. Межпроцессная и
distributed concurrency не входит в scope. Runtime policy остаётся draft/closed.

## Результат

Server обеспечивает порядок `reference → reaction start → diagnostic`, честный elapsed,
историчную пересъёмку и отсутствие двойного quota/specimen reservation в одном процессе.
