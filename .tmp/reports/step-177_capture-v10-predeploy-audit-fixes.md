# Step 177 — Capture V10 predeploy audit fixes

Дата: 2026-08-25

## Запрос / цель

Проверить пятишаговый Capture V10 hotfix из соседнего треда и подготовить к production deploy
только после устранения доказанных блокеров.

## Понимание задачи

- `RESULT`: проверенный runtime можно разворачивать как закрытый `draft/closed` release.
- `IN SCOPE`: аудит пяти коммитов, минимальные исправления lifecycle/recovery, связанные тесты и
  release gate.
- `OUT OF SCOPE`: научные значения V10 policy, запуск массовой пересъёмки, новая архитектура,
  миграции и physical acceptance телефонов.
- `MODE`: predeploy.

## План

1. Проверить commits/reports/scope.
2. Исправить только найденные deploy-блокеры.
3. Выполнить focused tests, typecheck, build и diff gate.

## Сделано

- После старта реакции reference upload и reference ROI заблокированы в UI, API и store.
- Создание пары получило внутренний client request ID: повторный запрос идемпотентен, а потерянный
  ответ восстанавливается без невидимой quota reservation.
- При одновременном сбое upload/ROI и reconcile слот возвращается в доступное retry-состояние;
  выбранный browser `File` остаётся в текущей вкладке.
- Восстановление проходит всю replacement-цепочку, а не только один переход.
- Старый `/api/roi-labels/v9/cases` исключает policy-driven V10 cases.
- Уточнён текст Capture: сервер задаёт допустимые pH, pH выбирает оператор.

## Изменённые файлы

- `packages/shared/src/index.ts`
- `apps/api/src/services/local-capture-store.ts`
- `apps/api/src/routes/cases.ts`
- `apps/api/src/routes/uploads.ts`
- `apps/api/src/routes/roi-labels.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/pages/CapturePage.tsx`
- `apps/api/src/services/capture-policy.test.ts`
- `apps/api/src/services/capture-lifecycle.test.ts`
- `apps/api/src/routes/admin.test.ts`

## Команды (что запускалось)

- focused policy/lifecycle/metadata/Admin tests: `25/25 passed`;
- `npm run typecheck`: passed;
- `npm run build`: passed;
- targeted Prettier check: passed;
- committed range и рабочий diff `git diff --check`: passed;
- `npm ls exifreader --all`: одна прямая runtime dependency `exifreader@4.44.0`.

## Риски / замечания

- Runtime policy остаётся `capture-v10`, `10.0-draft.1`, `draft/closed`: новые attempts запрещены.
- Source pH, quotas, device roles, conditions и reaction timing должны прийти из утверждённого SOP.
- Реальные iPhone/Samsung/Redmi и HEIC/EXIF проверяются только после deploy.
- Список shared specimens на уже открытом другом телефоне обновляется после refresh/смены выбора;
  polling не добавлялся.
- Production в рамках этого шага ещё не изменён.

## Результат

Пятишаговый hotfix соответствует anti-overengineering scope; найденные блокеры закрыты точечным
diff. Локальный release gate зелёный, код готов к отдельному exact-commit deploy.
