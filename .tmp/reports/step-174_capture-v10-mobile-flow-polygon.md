# Step 174 — Capture V10 mobile flow and polygon ROI

Дата: 2026-08-25

## Запрос / цель

Перевести operator Capture на policy-driven V10 flow без ручных кодов, добавить staged mobile UX,
blocking operation overlay и обязательный polygon ROI по policy.

## Понимание задачи

Committed policy остаётся `draft`, поэтому runtime UI обязан явно закрывать новую съёмку. Active
поведение реализуется по контракту policy без runtime toggle или параллельного V9 интерфейса.

## План

Удалить legacy task lookup/input, подключить Capture context и lifecycle actions, затем усилить
существующие `CapturePage`/`RoiEditor` и проверить production build и доступный browser smoke.

## Сделано

- draft policy показывает закрытый экран и не даёт создать пару;
- active flow использует пустые source/reference pH dropdowns, policy roles/modes/conditions и
  server quota `actual/target/reserved` без ручных task/specimen/series codes;
- device role запоминается в localStorage, shared/independent specimen выбирается без ручного ID;
- reference доступен после server-created attempt, reaction start — после reference + ROI,
  diagnostic закрыт до подтверждённого server reaction timestamp;
- target/tolerance отображаются только когда заданы оба значения, иначе показывается elapsed;
- restart/reshoot снова очищает оба pH и предлагает same/new specimen;
- final mixture pH отображается и валидируется строго по policy;
- единый fullscreen overlay блокирует upload, ROI save, reaction, finalize и replacement, показывает
  XHR byte progress либо indeterminate stage и поддерживает AbortController/XHR abort;
- после cancel/error выполняется GET reconcile без обещания rollback; неподтверждённые File/ROI
  остаются доступны для явного retry;
- polygon включён; при `requirePolygonRoi` он используется по умолчанию, rect недоступен и не может
  закрыть finalize;
- удалены legacy task route/map, client lookup и ручной create contract.

## Изменённые файлы

- `packages/shared/src/index.ts`;
- `apps/api/src/routes/cases.ts`;
- `apps/api/src/services/local-capture-store.ts`;
- `apps/api/src/services/capture-policy.test.ts`;
- `apps/web/src/lib/api.ts`;
- `apps/web/src/components/RoiEditor.tsx`;
- `apps/web/src/pages/CapturePage.tsx`;
- `apps/web/src/styles.css`.

## Команды (что запускалось)

- `npm run typecheck --workspace packages/shared`;
- `npm run typecheck --workspace apps/api`;
- `npm run typecheck --workspace apps/web`;
- `npm run build --workspace apps/web`;
- `npm exec tsx -- --test apps/api/src/services/capture-policy.test.ts` — 7/7 passed;
- `npm exec tsx -- --test apps/api/src/services/capture-lifecycle.test.ts` — 8/8 passed;
- targeted `prettier --check`;
- targeted `git diff --check`;
- local in-app browser smoke на 360×800 и 390×844 — draft screen видим, horizontal overflow нет.

## Риски / замечания

Active fixture flow нельзя проверить через runtime UI при committed `draft` policy без
запрещённого toggle; он покрыт shared/API typecheck и policy/lifecycle tests. Реальные device tests
не выполнялись и остаются вне scope.

## Результат

Capture V10 operator flow управляется policy и server lifecycle, сохраняет raw File/retry
поведение и блокирует конфликтующие mobile actions до фактического завершения операции.
