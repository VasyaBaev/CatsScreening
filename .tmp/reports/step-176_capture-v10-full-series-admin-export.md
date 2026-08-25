# Step 176 — Capture V10 full-series Admin and export

Дата: 2026-08-25

## Запрос / цель

Показать в Admin достоверный итог всей V10 серии и сделать воспроизводимые cases/attempts exports
с policy, lifecycle, replacement history и полными upload objects.

## Понимание задачи

Pagination списка кейсов не должна влиять на counters. Valid quota учитывает только current
`finalized + included` attempts, а legacy entries без V10 policy snapshot не входят в Admin или
exports.

## План

Расширить существующий fresh case manifest, вычислять summary по полному server dataset, добавить
один attempts JSONL endpoint и показать результат существующими Admin cards/tables/buttons.

## Сделано

- fresh case сохраняет policy snapshot/version, current lifecycle/replacement fields и полный
  `CaptureAttemptUpload`, включая optional camera metadata;
- finalized reshoot обновляет исторический case до `superseded`, не удаляя его;
- server summary читает все relevant attempts/cases независимо от page limit;
- quota matrix отдаёт pH × deviceRole × specimenMode с `actual/target/missing/reserved`;
- valid quota включает только current finalized included; active/reserved, abandoned, superseded,
  reshoots и excluded считаются отдельно;
- Admin показывает active policy ID/version/status, server counters, quota matrix и attempt history;
- cases CSV/JSONL сохранены без expected row count и дополнены policy/lifecycle/full images;
- добавлен простой `/api/admin/export.attempts.jsonl` для полной abandoned/superseded history;
- Admin и exports фильтруют V10 по policy ID/series snapshot и не смешивают legacy;
- ROI labeling и Playground не изменялись.

## Изменённые файлы

- `apps/api/src/services/local-capture-store.ts`;
- `apps/api/src/routes/admin.ts`;
- `apps/api/src/routes/admin.test.ts`;
- `apps/web/src/pages/AdminPage.tsx`.

## Итоговый gate

- focused policy/lifecycle/metadata/Admin API tests — 23/23 passed;
- `npm run typecheck` — passed;
- `npm run build` — passed, включая production web bundle;
- targeted `prettier --check` по owned files — passed;
- `git diff --check` для committed range и текущего шага — passed;
- exact step diff и cumulative stat просмотрены;
- runtime net diff от baseline — около 2407 строк, ниже ориентира 2500;
- owned paths не содержат `sources/`, deploy, Playground, unrelated research, env/secrets;
- до финального commit в range ровно четыре утверждённых implementation commits.

## Риски / замечания

Committed policy остаётся `draft/closed`, поэтому runtime quota matrix пока пуста до утверждения
научных значений. Реальные device/HEIC tests, deploy и production SSH не выполнялись.

## Результат

Admin получает full-series server truth, exports сохраняют policy/lifecycle/history/camera metadata,
а ветка проходит release-candidate gate и готова к отдельной проверке без deploy.
