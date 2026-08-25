# Step 179 — Capture ROI after diagnostic hotfix

Дата: 2026-08-25

## Запрос / цель

Исправить Capture lifecycle так, чтобы реакцию можно было начать после сохранения reference-файла
без обязательной ROI, а обе ROI размечались после diagnostic-снимка.

## Понимание задачи

- `RESULT`: оператор снимает reference, запускает реакцию, снимает diagnostic и только затем может
  сохранить ROI обоих кадров.
- `IN SCOPE`: точечные UI/API guards, lifecycle-тесты и release gate.
- `OUT OF SCOPE`: V10 policy, научный SOP, формат данных, новая архитектура и новые функции.
- `MODE`: fast → predeploy.

## План

1. Исправить server-side lifecycle guards.
2. Разделить блокировку original-файла и ROI в Capture UI.
3. Проверить утверждённый flow тестами, typecheck и build.

## Сделано

- Reaction start теперь требует только сохранённый reference-original.
- Reference original и ROI временно заблокированы от старта реакции до сохранения diagnostic.
- После diagnostic обе ROI доступны для разметки до finalize.
- Upload original больше не сохраняет default ROI автоматически: ROI сохраняется отдельным явным
  действием оператора.
- Отдельная замена reference после reaction start и diagnostic после первого upload запрещена;
  ошибочная фотография исправляется существующей полной пересъёмкой пары.
- Finalized attempt остаётся неизменяемым.

## Изменённые файлы

- `apps/web/src/pages/CapturePage.tsx`
- `apps/api/src/services/local-capture-store.ts`
- `apps/api/src/routes/cases.ts`
- `apps/api/src/routes/uploads.ts`
- `apps/api/src/services/capture-lifecycle.test.ts`

## Команды (что запускалось)

- `npm exec tsx -- --test apps/api/src/services/capture-lifecycle.test.ts` — 10/10 passed;
- `npm run typecheck` — passed;
- `npm run build` — passed;
- targeted Prettier check — passed;
- `git diff --check` — passed;
- независимый read-only review пяти изменённых runtime/test-файлов — замечаний нет.

## Риски / замечания

- V10 policy остаётся draft/closed и в этом шаге не изменяется.
- Physical mobile acceptance не относится к этому точечному lifecycle hotfix.
- Original-файлы намеренно не редактируются внутри завершённой пары; используется replacement.

## Результат

Утверждённый flow реализован и прошёл локальный release gate; hotfix готов к commit и production
deploy.
