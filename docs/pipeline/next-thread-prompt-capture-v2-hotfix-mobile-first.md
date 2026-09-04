# Prompt для нового треда — точечные Capture hotfixes и Mobile First

Скопируй весь блок ниже в новый тред Codex. Это канонический prompt для следующей реализации; старый production prompt не использовать.

````text
Ты работаешь с репозиторием `D:\dev\CatsScreening`.

Коммуникация с пользователем — на русском. Задачу нужно довести до работающего, запушенного и развёрнутого результата. Не создавай ещё один расширенный roadmap и не переписывай проект заново.

## Главная цель

Взять простой работающий сайт из commit `65d79768d2a310ab00b8763a4d88abeac5f4b67b` за архитектурную основу и выполнить только два вида работ:

1. Точечными hotfixes добавить уже согласованный новый функционал сбора серии, не меняя принципиально React/Vite + Fastify + локальное файловое хранение.
2. Сделать экран съёмки и первичного заполнения данных Mobile First для реальной работы с iPhone и Samsung.

После реализации: отдельный commit и push для каждого фиксированного шага, один итоговый release gate, deploy exact pushed SHA на действующий сайт и smoke-проверка. Текущую ветку `codex/production-like-capture-site` и все её незавершённые изменения оставить нетронутыми.

## Неподвижные границы

```text
RESULT: простой старый Capture site с точечными новыми функциями, удобной мобильной съёмкой, сохранёнными Playground/ROI/Admin и работающим deploy
IN SCOPE: capture/API/filesystem metadata, Mobile First layout Capture, минимальные Admin additions, сохранение Playground, проверки, commits, push, deploy
OUT OF SCOPE: перенос/миграция legacy-данных, compatibility layer, новая архитектура, новая БД, ML/chemistry work, security program, универсальный protocol platform
MODE: full
```

Источники требований — этот prompt и прямые новые сообщения пользователя. Старые планы, ADR, отчёты, тесты, незавершённый код и предполагаемые будущие угрозы дают только контекст и не расширяют scope.

## Почему именно этот baseline

В commit `65d7976` старый основной контур имеет примерно 2003 строки в 10 файлах:

- `apps/web/src/pages/CapturePage.tsx` — 646;
- `apps/web/src/pages/AdminPage.tsx` — 234;
- `apps/web/src/components/RoiEditor.tsx` — 278;
- `apps/web/src/lib/api.ts` — 114;
- `apps/api/src/routes/cases.ts` — 83;
- `apps/api/src/routes/uploads.ts` — 38;
- `apps/api/src/routes/admin.ts` — 179;
- `apps/api/src/services/local-capture-store.ts` — 68;
- `apps/api/src/services/local-image-storage.ts` — 75;
- `packages/shared/src/index.ts` — 288.

Это и есть рабочая архитектурная основа. Сохрани также существующие `App.tsx`, `styles.css`, ROI labeling, `PlaygroundPage.tsx`, `/api/analyze`, `playground:build` и Beget deploy scripts. Не заменяй их параллельной v2-подсистемой.

Не cherry-pick и не воспроизводи wholesale commits:

- `6a400eb`;
- `224c88e`;
- `a4ac8f8`;
- `e8388c1`.

Из них разрешено брать только отдельную маленькую реализацию, если она непосредственно закрывает один acceptance criterion и проще, чем написать такой hotfix в старом контуре.

## Безопасный старт без изменения текущей ветки

1. В `D:\dev\CatsScreening` read-only проверь `git status --short --branch`, remote и наличие `65d7976`.
2. Не выполняй `reset`, `checkout --`, `clean`, stash, force-push и не меняй текущую dirty-ветку.
3. Создай отдельный локальный worktree внутри игнорируемого каталога основного репозитория:

   ```powershell
   git -C D:\dev\CatsScreening worktree add -b codex/capture-hotfix-mobile-first D:\dev\CatsScreening\CatsScreening-hotfix 65d7976
   ```

4. Если такой worktree или branch уже существуют, сначала только проверь их состояние. Не удаляй и не перезаписывай их; при конфликте задай один конкретный вопрос.
5. Работай дальше только в `D:\dev\CatsScreening\CatsScreening-hotfix`.
6. В первом шаге перенеси из исходного дерева только актуальные:
   - `AGENTS.md`;
   - `.codex/workflows/skills-workflow.md`;
   - `docs/pipeline/next-thread-prompt-capture-v2-hotfix-mobile-first.md`.
7. `sources/` всегда read-only. Не копируй в новую ветку текущие незавершённые runtime changes, generated datasets, модели, фото или многочисленные untracked reports.

## Режим выполнения: KISS, YAGNI, практический SOLID

- Работай одним основным агентом, последовательно. Не запускай subagents.
- Не ищи в интернете: для этой реализации достаточно локального кода и этого prompt.
- KISS: сначала используй существующий route, component, filesystem store и CSS.
- YAGNI: не делай инфраструктуру и abstractions для вероятного будущего.
- SOLID: отделяй только реально разные ответственности; не создавай repositories/adapters/engines/interfaces ради паттерна.
- Новый framework, database, ORM, migration system, queue, worker, cache, object storage, state-machine framework, design system или UI library запрещены.
- Не добавляй dependency, если результат достижим текущими Node/Fastify/React/browser APIs.
- Не создавай новые ADR, большие contracts, threat models, test harnesses или планы. На commit — один компактный step report по существующему workflow.
- Любая побочная находка остаётся заметкой без кода, если она не блокирует acceptance criteria текущего шага.
- Если шаг выходит за 8 основных файлов, примерно 1000 строк net diff или 90 минут, упрости его внутри того же scope. Не создавай из сложности новые шаги.
- Цель для всего runtime diff — примерно до 2500 net LOC; при приближении к 4000 строк сделай hard stop, покажи, что раздуло diff, и предложи более простой вариант.

Запрещено делать «для надёжности» без доказанного blocker:

- перенос, import или schema migration старых данных;
- backward-compatibility layer и dual-write;
- SQLite/Postgres/Prisma schema для нового capture;
- event sourcing, audit chain, CQRS, repository split, generic FSM/protocol engine;
- leases, device enrollment, signed QR, roles/permissions matrix;
- resumable chunk protocol, background workers, queues, retention/tombstone subsystem;
- IndexedDB, service worker, offline-first sync;
- EXIF/ICC/orientation framework, HEIC decoder, automatic image QC suite;
- clock-tamper/rollback detection, schema fingerprints, hardlink/fsync durability framework;
- rate-limit/security-header/CORS redesign и общий security audit;
- ML inference, retraining, dataset migration или chemistry research;
- редизайн Admin, ROI labeling или Playground;
- Tailwind, component library или новый CSS framework.

Сохрани существующий простой уровень защиты и deploy policy. Исправляй security только если конкретный текущий дефект не позволяет безопасно выполнить этот deploy; тогда нужен минимальный локальный fix, без отдельной security-программы.

## Политика старых данных — без миграции

Старые фото, metadata и ROI уже сохранены в архиве. Не трать время на повторный backup, перенос, импорт, нормализацию или тесты совместимости.

Применяй ровно одно из двух простых решений:

1. Если старые строки `cases.jsonl` и uploads продолжают читаться существующим кодом без mapper, migration, dual schema и специальных веток, можно оставить их в Admin как read-only историю. Они не входят в counters/export новой серии.
2. Если для этого требуется любой compatibility code или новый функционал ломается на старом формате, не загружай legacy в новый flow. Оставь старые файлы физически нетронутыми и начни новую серию с пустого нового manifest/subdirectory внутри существующего `LOCAL_CAPTURE_STORAGE_DIR`.

Не удаляй архив. Не меняй старые записи. Не смешивай старые и новые counters. Возможность rollback старого сайта обеспечивается Git/release rollback, а не кодом совместимости.

## Обязательные новые hotfixes

Реализуй только следующее.

### 1. Задание и metadata

- Оператор вводит/сканирует короткий task code и получает server-defined задание.
- `sourcePh` приходит из задания и показывается read-only; оператор не может его изменить.
- `finalMixturePh` — отдельное nullable поле, оно никогда не подменяет `sourcePh`.
- Blank pH 6.13 — отдельный `blank_qc` task type, а не обычный reacted specimen.
- Один physical specimen на разных телефонах имеет одинаковый `specimenId`; `device` остаётся отдельным полем.
- Сохрани уже существующие operator/device/series/light/angle/distance metadata, если они не мешают flow.
- Не придумывай реальные task codes, pH или chemistry timings. Бери их только из уже зафиксированных локальных требований/config. Если точного значения нет и без него нельзя продолжить, задай один вопрос, а не проектируй универсальный редактор заданий.

### 2. Простые slots и время реакции

- Задание содержит обычный массив slots: reference и один или несколько diagnostic/QC slots.
- У slot достаточно `key`, `kind`, `label`, `required`, а для timed slot — target/tolerance из задания.
- Сервер фиксирует один `reactionStartedAt`; клиент показывает понятный countdown/elapsed time.
- Не создавай generic protocol engine или отдельную FSM library. Обычные TypeScript types, массив и простые проверки достаточны.

### 3. Фото, progress, retry и resume

- Mobile capture использует простой native `<input type="file" accept="image/*" capture="environment">`; не строй новую camera platform.
- Сохраняй исходные bytes выбранного браузером `File`; Canvas может быть только preview/ROI и не заменяет original.
- Убери black placeholder: до выбора фото показывай нейтральную понятную карточку, после выбора — реальное preview.
- Upload отправляет binary/multipart bytes, а не base64 JSON. Предпочти простой raw binary endpoint на существующем Fastify без новой dependency.
- Клиент использует `XMLHttpRequest.upload.onprogress` или эквивалентный реальный byte progress. Не изображай проценты для processing stages.
- Для каждого slot состояния: `empty`, `uploading`, `saved`, `error`; ошибка даёт retry и не сбрасывает уже сохранённые slots.
- Сервер возвращает и сохраняет фактические `bytes`, `sha256`, content type и storage URI.
- Refresh восстанавливает server-saved attempt и uploaded slots. Несохранённый локальный File после refresh можно попросить выбрать заново; IndexedDB не нужен.
- Finalize проверяет required slots. Повторный finalize не создаёт дубль, а возвращает уже сохранённый result.
- ROI хранится нормализованно через существующий `RoiEditor`; не переписывай редактор, если небольшой props/type hotfix достаточен.

### 4. Admin и Playground

- Admin показывает новую серию, базовые counters, included/excluded, `sourcePh`, `finalMixturePh`, specimen/device/task type и существующий CSV/JSONL export.
- Не строй campaign/worklist/device management UI. Task source может оставаться простым server-side config/file.
- ROI labeling остаётся рабочим на desktop и видит новые сохранённые фото через минимальную адаптацию, если это необходимо.
- `PlaygroundPage.tsx`, его data pack/build и `/api/analyze` не удалять, не переписывать и не связывать с capture schema.
- Если baseline намеренно скрывает `/playground` в production, сохрани существующую политику доступа: сейчас требуется сохранить функционал для дальнейшего использования, а не проводить отдельный публичный rollout Playground.

## Mobile First — точные границы

Mobile First обязателен для `/capture` и первичного заполнения данных.

- Базовые CSS rules рассчитаны на ширину 320–430 px; desktop enhancement идёт через `@media (min-width: ...)`.
- Одна колонка, без горизонтального scroll; карточка фото занимает доступную ширину.
- Размер интерактивной области минимум 44×44 px.
- Inputs не меньше 16 px font-size, чтобы iPhone не делал zoom.
- Учитывай `env(safe-area-inset-*)` там, где нижняя/верхняя панель может перекрыть action.
- Главный action и текущий status должны быть заметны; sticky допустим только если не закрывает содержимое и клавиатуру.
- Минимизируй ввод: remembered operator/device через существующий простой browser storage допустим; pH не запоминать и не редактировать.
- Task code, таймер, текущий slot, progress, retry и подтверждение сохранения должны читаться с одного экрана без desktop-sized таблиц.
- Поддержи portrait; landscape не должен ломаться, но отдельный landscape design не нужен.
- Проверить минимум viewport `360×800` (Samsung class) и `390×844` (iPhone class). На обоих: нет horizontal overflow, все actions доступны, клавиатура не делает основной flow непроходимым.
- `/admin`, `/roi-labeling` и будущий `/playground` могут оставаться desktop-oriented. Нужно лишь не сломать их существующую responsive-вёрстку.

Не делай полный визуальный редизайн. Сохрани текущие цвета, компоненты и визуальный язык; меняй layout, spacing, sizing, order и mobile controls только для удобства съёмки.

## Фиксированный план: один шаг = один commit + push

Перед каждым commit:

1. обнови один компактный `.tmp/reports/step-XXX_<name>.md`;
2. запусти targeted checks изменённой поверхности;
3. выполни `git diff --check` и просмотри точный diff;
4. stage только явными pathspec, никогда `git add .`/`git add -A`;
5. commit;
6. push обычным `git push`, без force.

Не добавляй новые implementation-шаги. Доказанный blocker текущего результата устраняй внутри текущего шага. Побочные идеи не реализуй.

### Шаг 1 — сохранить минимальную агентскую обвязку

Commit: `docs: add capture hotfix delivery guardrails`

- перенести три перечисленных instruction/prompt файла из исходного дерева;
- убедиться, что rules прямо запрещают scope creep, migration/backward compatibility без запроса и архитектуру «на будущее»;
- runtime не менять.

### Шаг 2 — точечные server/API hotfixes

Commit: `feat: add capture task and upload hotfixes`

- расширить существующие shared types, routes и local filesystem services;
- task lookup, attempt/resume, slots/reaction time, original binary upload, bytes/hash, ROI, idempotent finalize;
- использовать существующий storage root и минимальные JSON/JSONL files; при изменяемом attempt допустим один маленький per-attempt JSON file с temp+rename;
- не использовать Prisma/database migrations и не создавать отдельный capture-v2 framework;
- проверить минимум happy path, retry/double-finalize и exact bytes/hash через Fastify inject или небольшой локальный smoke без установки test framework.

### Шаг 3 — Mobile First Capture

Commit: `feat: make capture workflow mobile first`

- точечно изменить `CapturePage`, существующий API helper, `RoiEditor` props только при необходимости и `styles.css`;
- реализовать task/read-only pH, native camera/file input, slots/timer, preview, honest progress, retry/resume/finalize;
- проверить 360×800 и 390×844 в браузере, сделать screenshots только как временное QA evidence, не коммитить их;
- не менять Admin/Playground дизайн в этом шаге.

### Шаг 4 — Admin history boundary и сохранение desktop tools

Commit: `feat: expose new capture metadata in admin`

- минимально расширить Admin counters/list/export новой серии;
- legacy показывать только при нулевой compatibility cost, иначе не подмешивать;
- проверить ROI labeling;
- подтвердить, что Playground page, pack build и analyze functionality сохранены и build проходят; не переделывать их.

### Шаг 5 — release candidate и существующий Beget deploy

Commit: `chore: prepare capture hotfix release`

- выполнить один итоговый gate: `npm run typecheck`, `npm run build`, связанные targeted API/browser smokes, `git diff --check`, UTF-8/CRLF;
- не добавлять Playwright/Vitest/новый harness только ради этого шага; используй уже имеющиеся команды и небольшие smoke checks;
- изменить существующие deploy files только если это доказанно требуется для нового runtime/storage path;
- зафиксировать compact release report и exact SHA;
- push commit.

## Deploy после пяти шагов

Используй существующий Beget workflow и `docs/capture/beget-vps-deploy.md`. Не выбирай новый hosting.

1. Убедись, что local HEAD равен pushed remote SHA и working tree нового worktree чистый.
2. Запиши текущий active release/SHA для rollback.
3. Собери artifact из exact pushed commit, не из исходной dirty-ветки.
4. Не запускай data migration и не преобразовывай legacy storage.
5. Если выбран чистый manifest/subdirectory новой серии, создай только его; старые файлы оставь на месте.
6. Разверни существующим reversible release/symlink mechanism.
7. Проверь production `/api/health`, `/capture`, загрузку app assets и один контролируемый capture happy path. При blocker автоматически верни предыдущий release.
8. Выдай пользователю один короткий физический checklist для iPhone Safari и Samsung Chrome. Разметку ROI/Admin/Playground проверять на desktop.
9. Если физическая проверка выявит реальный blocking defect, сделай один минимальный corrective commit, targeted check, push и redeploy. Не превращай его в новый roadmap.

Не печатай secrets и не коммить production env. Не делай force-push. Не переписывай Git history.

## Definition of Done

Работа завершена только когда:

- текущая dirty-ветка `codex/production-like-capture-site` осталась нетронутой;
- новая ветка основана на `65d7976`, а не на незавершённой v2 архитектуре;
- все пять шагов имеют отдельные commits и каждый commit запушен;
- capture task/locked source pH/final mixture pH/blank QC/specimen grouping/slots/timer работают;
- оригинальные bytes сохраняются, progress честный, error retry не теряет готовые фото, refresh восстанавливает server state, finalize идемпотентен;
- Capture удобен и не имеет horizontal overflow на 360×800 и 390×844;
- Admin показывает новую серию и export, не требуя migration legacy;
- ROI labeling и Playground functionality не удалены и не сломаны;
- typecheck/build/targeted smokes зелёные;
- exact pushed SHA развёрнут на действующий сайт, health/capture smoke зелёные, rollback SHA известен;
- итоговый ответ коротко перечисляет commits, production SHA/URL, проверки, выбранную политику legacy (`historical read-only` или `fresh empty series`) и только реальные оставшиеся ограничения.

Начни с read-only preflight и создания отдельного worktree. Затем выполняй фиксированные шаги до deploy; не останавливайся ради необязательных улучшений.
````

