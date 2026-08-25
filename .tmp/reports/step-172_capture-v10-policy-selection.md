# Step 172 — Capture V10 policy selection

Дата: 2026-08-25

## Запрос / цель

Добавить draft V10 policy, server-side context/quota summary, автоматические IDs и валидацию
policy-driven выбора без ручных task/specimen codes.

## Понимание задачи

Committed policy обязана оставаться закрытой до утверждения научных значений. Active policy
проверяется только тестовой fixture без runtime toggle.

## План

Расширить shared contracts, добавить один active-policy module, переиспользовать существующие
Fastify routes и filesystem attempts, затем проверить поведение на временном storage.

## Сделано

- добавлены policy/context/quota/shared-specimen schemas и refinements;
- runtime policy зафиксирована как `draft`, `referencePh = 6.13`, без source pH, quotas и timing;
- `GET /api/cases/context` отдаёт policy snapshot, quota summary и доступные shared specimens;
- V10 attempt создаётся только по объявленным policy значениям, с server-generated UUID;
- series/policy snapshot берутся с сервера, legacy attempts без snapshot не входят в V10 quota;
- draft create возвращает понятный `409 CAPTURE_POLICY_DRAFT`.

## Изменённые файлы

- `packages/shared/src/index.ts`;
- `apps/api/src/config/active-capture-policy.ts`;
- `apps/api/src/routes/cases.ts`;
- `apps/api/src/services/local-capture-store.ts`;
- `apps/api/src/services/capture-policy.test.ts`.

## Команды (что запускалось)

- `npm run build --workspace packages/shared`;
- `npm run typecheck --workspace packages/shared`;
- `npm run typecheck --workspace apps/api`;
- `node --import tsx --test apps/api/src/services/capture-policy.test.ts` — 7/7 passed;
- targeted `prettier --check`;
- targeted `git diff --check`.

## Риски / замечания

Policy остаётся закрытой; source pH, device roles, specimen plan, quotas и reaction timing ждут
утверждения. Старый task lookup сохраняется как временный compile-safe мост до шага 3.

## Результат

Server готов к policy-driven V10 selection и quota context, но массовая V10 серия безопасно
закрыта draft policy.
