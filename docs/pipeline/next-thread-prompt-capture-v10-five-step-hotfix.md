# Prompt для пустого треда — Capture V10, пятишаговый точечный hotfix

Скопируй весь блок ниже в новый тред Codex с пустым контекстом.

````text
Ты реализуешь утверждённый Capture V10 hotfix в проекте CatsScreening. Это implementation-задача,
а не новое исследование и не архитектурное проектирование.

Коммуникация с пользователем — на русском.

## Конечный результат

Точечно расширить существующий React/Vite + Fastify + filesystem Capture:

1. policy-driven pH/device/specimen flow без ручных task-кодов;
2. правильный lifecycle `reference → начать реакцию → diagnostic`, пересъёмка и минимальная
   защита от гонок;
3. blocking progress UI, cancel/reconcile и обязательный polygon ROI;
4. best-effort camera metadata из исходного upload-файла;
5. полносерийные Admin counters/quotas и воспроизводимые exports.

Ровно пять implementation-шагов ниже. Каждый шаг:

- даёт один наблюдаемый результат;
- получает один отдельный commit;
- включает один компактный step-report;
- проходит свои targeted checks;
- после commit отправляется обычным push в ту же remote-ветку.

После пятого шага выполнить итоговый gate и push. **Не деплоить.** Не подключаться к production
по SSH, не запускать deploy script и не изменять сервер. После завершения пользователь вернётся
в исходный тред, где другой агент проверит diff/commits и отдельно выполнит deploy.

## Уже принятые решения

- `APPROVED`: весь пятишаговый scope из этого prompt.
- `APPROVED`: неизменённая dependency `exifreader@4.44.0` под MPL-2.0.
- `REQUIRED`: точный hotfix поверх текущего сайта; архитектурная замена запрещена.
- `REQUIRED`: код заранее готов к policy/SOP, но научные числа не выдумываются.
- `OPEN DECISION`: финальные V10 pH, quotas, shared/independent counts, condition plan,
  reaction target/tolerance и обязательность `finalMixturePh`.
- `OPEN DECISION`: точная модель Redmi для последующего physical acceptance.

Открытые policy-значения не блокируют реализацию. Они блокируют только открытие массовой V10
серии. Активная runtime-policy после этих пяти шагов должна оставаться явно `draft/closed` до
отдельного заполнения и проверки.

## Рабочее дерево и Git

Работай только здесь:

`D:\dev\CatsScreening\CatsScreening-hotfix-safe`

Ожидаемая ветка:

`codex/capture-hotfix-mobile-first`

Ожидаемый стартовый commit:

`c3acddaa44bbc824df5b7f86c66a7d873a991617`

Upstream:

`origin/codex/capture-hotfix-mobile-first`

Не создавай новую ветку или worktree. Не работай в `D:\dev\CatsScreening`.

До изменения файлов:

1. Полностью прочитай:
   - `D:\dev\CatsScreening\CatsScreening-hotfix-safe\AGENTS.md`;
   - `D:\dev\CatsScreening\CatsScreening-hotfix-safe\.codex\workflows\skills-workflow.md`;
   - `D:\dev\CatsScreening\CatsScreening-hotfix-safe\docs\capture\capture-v10-hotfix-analysis-after-camera-research.md`;
   - `D:\dev\CatsScreening\CatsScreening-hotfix-safe\.tmp\capture-reshoot-hotfix-scope-draft.md`;
   - `D:\dev\CatsScreening\CatsScreening-hotfix-safe\docs\research\notes\browser-camera-metadata-library-review-2026-08.md`;
   - `D:\dev\CatsScreening\CatsScreening-hotfix-safe\docs\capture\camera-telemetry-physical-device-test-protocol.md`.
2. Read-only изучи текущие contracts/runtime:
   - `packages/shared/src/index.ts`;
   - `apps/api/src/routes/cases.ts`;
   - `apps/api/src/routes/uploads.ts`;
   - `apps/api/src/routes/admin.ts`;
   - `apps/api/src/services/local-capture-store.ts`;
   - `apps/api/src/services/local-image-storage.ts`;
   - `apps/web/src/pages/CapturePage.tsx`;
   - `apps/web/src/pages/AdminPage.tsx`;
   - `apps/web/src/components/RoiEditor.tsx`;
   - `apps/web/src/lib/api.ts`;
   - `apps/web/src/styles.css`;
   - `apps/api/package.json`, root `package.json` и `package-lock.json`.
3. Выполни `git status --short --branch`, проверь branch/HEAD/upstream.
4. Зафиксируй список уже существующих modified/untracked paths. Они принадлежат пользователю.

В worktree уже есть незакоммиченные research/capture документы и отчёты, включая изменённый
`docs/research/research-map.md`. Не удаляй, не форматируй, не stage и не commit их. Новый prompt
и его step-report также не входят в implementation commits.

Запрещены:

- `git reset --hard`, `git checkout --`, `git clean`, stash;
- force-push, rebase и переписывание уже опубликованной истории;
- `git add .` и `git add -A`;
- pull/merge чужих изменений без отдельного разрешения.

Stage только явными pathspec текущего шага. Если branch/HEAD/upstream отличаются от ожидаемых
или обычный push rejected из-за чужого remote update, остановись и задай один конкретный вопрос.

## Неподвижная scope card

```text
RESULT: policy-ready Capture V10 hotfix реализован пятью точечными commits и запушен без deploy
IN SCOPE: policy/pH/specimen/quota contracts, lifecycle/reshoot/concurrency, Capture UX/polygon, server EXIF, Admin/export, targeted tests и final build gate
OUT OF SCOPE: production deploy, реальные device tests, заполнение научных значений V10 policy, ML/chemistry, legacy migration, новая архитектура и новые функции
MODE: full implementation, stop before deploy
```

Источники требований — этот prompt и только явно перечисленные выше актуальные документы.
Старый код, отчёты, тесты, ADR и побочные находки сами по себе не создают новые требования.

## Фактический baseline, который нужно сохранить

- React/Vite frontend, Fastify API, один Node process и filesystem JSON/JSONL storage.
- Web уже отправляет исходный `File` через XHR без Canvas/JPEG re-encode.
- API принимает исходный `Buffer` до 30 MiB, storage сохраняет bytes и SHA-256.
- Upload имеет slot states, byte progress, retry; attempt восстанавливается после refresh.
- Finalize идемпотентен, excluded case поддерживается.
- Capture уже mobile-first.
- ROI editor уже умеет polygon, но Capture сейчас передаёт `allowPolygon={false}`.
- Admin export уже выгружает finalized fresh cases, но UI counters считает только полученную
  страницу до 100 items.
- Текущий ручной `taskCode` и hardcoded task map должны исчезнуть из финального V10 operator flow.
- Текущий `reactionStartedAt` ставится при создании attempt — для V10 это неверно.
- `finalMixturePh` сейчас виден в обычном flow — для draft V10 его нужно скрывать policy-флагом.
- Playground, ROI-labeling, `/api/analyze` и Beget deploy files не относятся к реализации и не
  должны быть сломаны или переписаны.

## Anti-overengineering — обязательные правила

Работай одним основным агентом, последовательно. Не запускай subagents. Не выполняй новое
интернет-исследование; разрешён только обычный npm install одной уже одобренной dependency.

KISS:

- сначала переиспользуй существующие routes, Zod schemas, `CapturePage`, `RoiEditor`,
  filesystem attempts и JSONL;
- один небольшой active-policy module, не policy service/CMS/editor;
- один небольшой metadata helper, не telemetry framework;
- одна короткая process-local critical section, не distributed locking;
- обычные TypeScript unions/guards, не FSM library;
- один operation state/overlay, не UI state-machine framework.

YAGNI — запрещено:

- новая БД, SQLite/Postgres schema, Prisma migration или import/backfill;
- compatibility/dual-write layer для legacy;
- queue, worker, cache, event sourcing, audit chain, CQRS;
- repositories/adapters/engines/interfaces ради паттерна;
- campaign/worklist/protocol platform;
- leases, device enrollment, QR/штрихкоды, печать этикеток;
- service worker, IndexedDB, offline-first;
- chunked/resumable upload protocol;
- новый camera preview, `getUserMedia` probe, `ImageCapture` или native bridge;
- автоматическая image QC, HEIC decoder или Canvas conversion;
- новый UI framework, component library, design system или полный редизайн;
- новый test framework, Playwright/Vitest harness;
- security redesign, rate-limit/CORS/header program;
- ML retraining, chemistry calculations или обработка mini-research results;
- автоматическое определение exact phone/lens из User-Agent;
- generic condition scheduler до утверждённой V10 policy.

Допустимы максимум три новых небольших runtime-файла за всю работу:

1. active capture policy module;
2. camera metadata helper;
3. optional маленький overlay component, только если это объективно уменьшает `CapturePage`.

Test-файлы и пять step-reports в этот лимит не входят.

Stop-budget каждого шага:

- максимум 8 основных файлов;
- ориентир до 1000 net LOC;
- максимум 90 минут;
- никакой новой подсистемы.

Если шаг приближается к лимиту, сначала упрости механизм внутри того же acceptance. Не создавай
шестой implementation-шаг и не расширяй архитектуру. Если после упрощения результат всё равно
недостижим, остановись и задай один конкретный вопрос.

Для всего пятишагового runtime diff ориентир — до 2500 net LOC. Hard stop около 3500 runtime LOC:
покажи, что раздуло diff, и не продолжай без решения пользователя.

## Policy-ready контракт без выдуманных научных значений

Используй один маленький TypeScript module наподобие
`apps/api/src/config/active-capture-policy.ts`. Объект валидируется существующим Zod-контрактом
при startup/import. Не добавляй файловый watcher, Admin editor, remote config, feature-flag
service или env-слои.

Минимальные поля policy:

- `policyId`, `version`, `seriesId`;
- `status: "draft" | "active"`;
- `referencePh`;
- allowed source pH;
- device roles с понятными labels;
- разрешённые specimen modes `independent/shared`;
- quotas по `sourcePh × deviceRole × specimenMode`;
- allowed light/angle/distance options или их компактный текущий эквивалент;
- `requirePolygonRoi`;
- plain laboratory instruction text;
- nullable `reactionTargetSeconds/reactionToleranceSeconds`;
- `showFinalMixturePh/requireFinalMixturePh`.

После реализации committed policy остаётся:

- `status: "draft"`;
- mass capture закрыт;
- `referencePh = 6.13`;
- без выдуманных source pH, quota counts и reaction times;
- final mixture pH скрыт и не обязателен;
- с явным текстом «политика V10 ожидает утверждения».

Для draft допустимы пустые source pH/quotas. Для active policy schema обязана проверять:

- непустые source pH/device roles;
- quota cells с положительным target;
- значения quota ссылаются только на declared pH/roles/modes;
- reference/source pH находятся в 0..14;
- target/tolerance либо оба null, либо оба корректны;
- required final mixture pH нельзя включить при скрытом поле.

Тесты используют маленькую active-policy fixture. Не добавляй runtime toggle только ради тестов.
После chemistry mini-research владелец должен менять только этот policy module и выполнять
обычный build/deploy; Capture/API logic не переписывается.

## Общие функциональные инварианты

1. Каждая новая и переснимаемая пара начинает с пустых source/reference pH dropdown.
2. Source pH выбирается только из ещё доступных policy values; готовые остаются видимыми
   disabled как `готово N/N`.
3. Reference dropdown имеет единственное policy value 6.13, но его всё равно нужно выбрать.
4. Нельзя создать/сохранить reference без обоих явно выбранных pH.
5. Оператор не вводит task/specimen/pair codes. Server генерирует IDs; UI показывает только
   read-only label.
6. Series берётся из policy. Device role выбирается из policy и может запоминаться локально;
   exact модель не угадывается из UA.
7. Independent specimen создаётся автоматически. Shared specimen выбирается из незакрытых
   server-generated вариантов; один device role не закрывает его дважды.
8. Последовательность: reference upload + valid ROI → `Начать реакцию` → diagnostic upload.
9. Server reaction time сначала null и фиксируется отдельным idempotent action. Diagnostic
   server `savedAt` даёт `reactionElapsedSec`.
10. До утверждённого SOP нет hardcoded научного окна и автоматического исключения по времени.
11. Active attempt можно abandoned/restart. Finalized pair можно пометить для reshoot; старая
    версия остаётся в истории, но перестаёт закрывать quota. Silent overwrite и физическое
    удаление файлов запрещены.
12. Reshoot снова требует ручного выбора обоих pH; старые значения могут быть только read-only
    подсказкой. Оператор выбирает тот же или новый specimen.
13. Upload/ROI/reaction/finalize/reshoot используют единый blocking operation UI. Byte percent
    показывается только для реальной передачи файла; server work — indeterminate.
14. Cancel abort-ит клиентский request и затем reconciles фактический attempt. Не обещать
    rollback, если сервер уже сохранил файл. Не делать silent automatic retry.
15. Если policy требует polygon, новый ROI начинается polygon, touch editing доступен, а server
    не финализирует пару без валидного polygon на required slots.
16. Original bytes и SHA остаются неизменными.
17. Quota/Admin считают только текущие valid finalized included attempts. Abandoned,
    superseded/reshoot и excluded видны в истории, но не закрывают quota.
18. Разные телефоны работают параллельно. В одном production Node process короткий
    process-local lock защищает только read-modify-write reserve/finalize/reshoot и attempt
    updates; uploads разных attempts не блокируются на всё время передачи.

Для lifecycle выбери минимальное число состояний. Не добавляй одновременно
`reshoot_requested` и `superseded`, если одного persisted статуса плюс replacement links
достаточно для acceptance.

## Шаг 1 — policy/contracts, automatic IDs и quota context

Наблюдаемый результат: server имеет одну draft V10 policy, отдаёт Capture context, валидирует
active-policy selections, автоматически создаёт IDs и считает quota availability. Существующий
UI пока может использовать старый путь только как временный compile-safe мост до шага 3; не
строить compatibility layer.

Минимальная поверхность:

- shared schemas/types;
- один новый active-policy module;
- существующий `cases.ts`;
- существующий filesystem capture store;
- additive functions в web API client, если нужны следующему шагу;
- focused tests;
- один step-report.

Обязательное поведение:

- GET context/policy возвращает policy status, policy snapshot, server quota summary и доступные
  shared specimens для выбранной role/mode;
- draft policy блокирует создание V10 attempt понятной ошибкой;
- active test fixture принимает только declared pH/role/mode;
- server генерирует `attemptId/pairId/specimenId` и read-only display label;
- `seriesId` и policy snapshot берутся с сервера, не из свободного input;
- quota summary считает actual/reserved/target и не использует hardcoded total;
- old attempts без V10 policy ID не входят в V10 quotas; backfill/migration не выполняется;
- no manual code generation from pH.

Targeted checks:

- policy schema/refinements;
- draft blocks create;
- invalid pH/role/mode rejected;
- automatic IDs are opaque and do not encode pH;
- independent/shared specimen selection;
- quota summary on a temporary storage directory;
- shared/API typecheck and relevant focused tests;
- `git diff --check` for owned paths.

Commit message:

`capture: add policy-driven task selection`

Создай следующий свободный `.tmp/reports/step-XXX_capture-v10-policy-selection.md`, stage только
файлы этого шага, commit и выполни обычный push в upstream. Не amend после push.

## Шаг 2 — reaction lifecycle, reshoot и минимальная конкурентность

Наблюдаемый результат: server обеспечивает правильный порядок пары, честное время реакции,
restart/reshoot semantics и отсутствие двойного quota/specimen зачёта в одном Node process.

Переиспользуй shared/store/routes из шага 1. Не создавай workflow engine или lock service.
Достаточна маленькая module-local promise critical section либо столь же простой механизм.

Обязательное поведение:

- новые attempts имеют `reactionStartedAt = null`;
- reaction start возможен только после сохранённого reference с валидным ROI;
- reaction start идемпотентен;
- diagnostic upload до reaction start получает conflict;
- diagnostic saved time записывается server-side; elapsed вычисляется от reaction start;
- active restart помечает старый attempt abandoned, освобождает reservation и создаёт/готовит
  новую попытку без удаления файлов;
- finalized reshoot связывает old/new attempts replacement IDs; old больше не закрывает quota;
- incomplete replacement остаётся явно видимым как незакрытая quota;
- same specimen/new specimen choice поддерживается без ручного ID;
- одна quota cell не резервируется дважды при параллельных requests;
- для `policy + specimen + deviceRole` не существует двух active attempts; повторный request
  возвращает существующий attempt либо понятный conflict/context;
- finalized/excluded/reshoot transitions обновляются атомарной записью существующих JSON files;
- глобальная блокировка всей серии, distributed lock и новый storage запрещены.

Не переписывай текущие raw uploads. Короткий lock охватывает только state transition, а не
передачу 30 MiB файла.

Targeted checks:

- start before reference rejected;
- duplicate reaction start returns same timestamp;
- diagnostic before start rejected;
- elapsed uses server timestamps;
- abandon/reshoot releases quota and preserves history;
- concurrent requests for final quota cell produce one reservation;
- concurrent same specimen/device does not create two active attempts;
- focused API/store tests, relevant typecheck и `git diff --check`.

Commit message:

`capture: add staged reaction and reshoot lifecycle`

Создай следующий step-report, explicit stage, commit и обычный push.

## Шаг 3 — Capture UI: dropdowns, staged flow, overlay и polygon

Наблюдаемый результат: оператор проходит новый V10 flow без ручных кодов и не может случайно
переключить pH/пару во время сохранения.

Изменяй существующие `CapturePage.tsx`, `apps/web/src/lib/api.ts` и `styles.css`. Используй
существующий `RoiEditor`. Новый маленький overlay component допустим только если он реально
уменьшает и упрощает `CapturePage`; не создавать hooks/state-machine abstraction.

Обязательное поведение:

- при draft policy экран ясно сообщает, что серия закрыта и ожидает policy; новая пара
  недоступна;
- при active fixture/source source pH и reference pH dropdown исходно пустые;
- reference value 6.13 не preselect;
- source options показывают `actual/target`; completed disabled, не скрыты;
- нет manual task code, specimen code или series input;
- device role выбирается из policy и может запоминаться в current localStorage;
- independent/shared flow не требует ручного ID;
- reference slot доступен только после явного выбора обоих pH и создания attempt;
- `Начать реакцию` появляется только после saved reference + polygon ROI;
- diagnostic controls закрыты до successful reaction start;
- elapsed/countdown использует policy target/tolerance только когда оба не null; иначе только
  честный elapsed;
- active restart и finalized reshoot доступны и снова обнуляют оба pH dropdown;
- final mixture pH скрыт/required строго по policy;
- один полноэкранный overlay блокирует остальные controls для upload, ROI save, reaction start,
  finalize и reshoot;
- upload показывает реальный XHR byte progress; server stages показывают spinner/indeterminate;
- error/success имеют понятный текст;
- cancel использует AbortController/XHR abort и затем GET attempt/context reconcile;
- не обещать rollback и не создавать вторую попытку молча;
- polygon включён; при `requirePolygonRoi=true` default ROI polygon и rect не может закрыть
  finalize;
- touch targets, 16 px inputs, safe areas и одна колонка сохраняются;
- existing resume/retry/raw File flow не ломается.

После cutover удали из финального operator flow старый task-code lookup/map/inputs. Не оставляй
скрытую параллельную V9 capture UI и не добавляй feature flag. Internal opaque task/pair field
может остаться в persisted schema, если оператор его не вводит и он не кодирует pH.

Targeted checks:

- web/shared/API typecheck;
- production web build;
- focused client helper tests, если уже есть подходящий механизм; новый UI test framework не
  добавлять;
- локальный browser smoke только если доступен без нового harness: draft screen, active fixture
  flow, 360×800 и 390×844, no horizontal overflow;
- `git diff --check`.

Commit message:

`capture: harden mobile flow and polygon roi`

Создай следующий step-report, explicit stage, commit и обычный push.

## Шаг 4 — bounded camera metadata из exact upload bytes

Наблюдаемый результат: каждый новый upload содержит честный best-effort metadata status и
нормализованные значения из того же файла/SHA; parser никогда не ломает сохранение фотографии.

Используй только:

- optional `cameraMetadata` в `CaptureAttemptUploadSchema`;
- новый `apps/api/src/services/image-metadata.ts`;
- вызов helper из существующего `local-image-storage.ts`;
- exact dependency `exifreader@4.44.0`;
- package-lock и focused `node:test`/`tsx` tests.

Для core result не менять Capture UI, web API client, upload route, capture store или Admin.
Если типизация объективно требует маленькую правку, зафиксируй доказательство в report и не
расширяй scope.

Compact schema:

```text
cameraMetadata
  schemaVersion
  capturePath = web_file_input
  parser { name, version, status, diagnosticCode }
  detectedContainer
  values { nullable normalized fields }
  sources { normalizedField -> group, rawTag, unit }
  privacy { gpsStatus }
```

Нормализовать, только если реально присутствуют:

- Make/Model/Software и даты/offset;
- ExposureTime seconds, FNumber, ISO aliases, ExposureBias EV, ExposureProgram/Mode,
  MeteringMode;
- WhiteBalance только Auto/Manual, LightSource;
- Kelvin только из явно именованного документированного XMP/vendor tag, без inference;
- Flash, FocalLength, 35 mm equivalent, LensMake/LensModel, SubjectDistance;
- Orientation, pixel dimensions, EXIF ColorSpace, ICC presence/description.

Parser statuses:

- `parsed`;
- `no_metadata`;
- `unsupported_format`;
- `parse_error`.

При любом статусе original upload остаётся успешным, если bytes сохранены. Не сохранять полный
parser result, thumbnails, MPF, XMP text, ICC/MakerNote binary, raw stack/path/error. GPS
coordinates не выходят из helper; только `present_then_discarded` или `absent_or_stripped`.
Original остаётся byte-identical и может физически содержать GPS — не переписывать его.

Не добавлять `exifr`, `@xmldom/xmldom`, client parser, `sharp.metadata()` pass, WebRTC wrapper,
`getUserMedia` или `ImageCapture`. Не восстанавливать отсутствующие значения эвристикой.

Установка:

`npm install --workspace apps/api --save-exact exifreader@4.44.0`

Минимальные tests:

- JPEG с известным EXIF;
- image без EXIF;
- malformed metadata;
- ISO alias normalization;
- WhiteBalance остаётся Auto/Manual;
- no Kelvin inference;
- GPS coordinates не попадают в result;
- bounded strings/binary exclusion;
- bytes/SHA не меняются;
- `no_metadata/parse_error` не превращают upload в HTTP failure;
- старый attempt без optional field читается.

Не загружай fixtures из интернета. Маленькие test buffers/base64 constants допустимы. HEIC
реального iPhone проверяется только после будущего deploy, не расширяй этот шаг.

Commit message:

`capture: persist bounded camera metadata`

Создай следующий step-report, explicit stage, commit и обычный push.

## Шаг 5 — full-series Admin/export и итоговый release-candidate gate

Наблюдаемый результат: Admin показывает достоверный итог всей V10 серии и exports содержат
policy/lifecycle/history/camera metadata; branch готова к отдельной проверке и будущему deploy.

Обязательное поведение:

- server summary считается по всем relevant attempts/cases, не по first page;
- Admin показывает active policy ID/version/status;
- quota matrix: pH × deviceRole × specimenMode, `actual/target/missing`;
- valid quota включает только current finalized included attempts;
- active/reserved, abandoned, superseded/reshoot и excluded видны отдельными counts/history;
- list pagination может остаться; counters берутся из server summary;
- existing cases CSV/JSONL сохраняются без hardcoded expected row count;
- finalized case export содержит policy snapshot/version и full image upload object, включая
  cameraMetadata;
- добавь один простой attempts JSONL export, если иначе abandoned/superseded history невозможно
  выгрузить; не создавай ZIP/bundle service или новую dependency;
- policy snapshot хранится с attempt/case, чтобы последующее изменение active module не меняло
  смысл уже снятых данных;
- fresh V10 не смешивается с legacy;
- ROI labeling и Playground продолжают читать свои существующие источники.

Не редизайни Admin. Достаточны существующие cards/table/buttons.

До commit шага 5 выполни один итоговый gate:

1. Все focused policy/lifecycle/metadata/API tests.
2. `npm run typecheck`.
3. `npm run build`.
4. Targeted Prettier check только owned files; не форматировать весь dirty worktree.
5. `git diff --check c3acddaa44bbc824df5b7f86c66a7d873a991617..HEAD` плюс uncommitted
   diff текущего шага.
6. Просмотреть `git diff --stat` и точный owned diff.
7. Проверить, что не изменены `sources/`, deploy files, Playground, unrelated research,
   production env/secrets.
8. Проверить stop-budget: пять implementation commits, без шестого roadmap/fix commit.

Если final gate находит blocker, исправь его до commit шага 5 только минимально в рамках уже
утверждённых acceptance criteria, затем один раз повтори затронутые checks.

Commit message:

`capture: add full-series quota admin and export`

Создай следующий step-report, explicit stage, commit и обычный push.

## Git-процедура каждого шага

Перед каждым commit:

1. `git status --short`;
2. targeted tests изменённой поверхности;
3. targeted formatting только owned files;
4. `git diff --check`;
5. просмотреть exact diff;
6. создать один компактный step-report;
7. `git add -- <явные paths текущего шага>`;
8. проверить `git diff --cached --stat` и `git diff --cached`;
9. commit с фиксированным message;
10. `git push origin HEAD:codex/capture-hotfix-mobile-first` без force.

Не amend опубликованные commits. Не коммить prompt, прежние reports/research notes или
`docs/research/research-map.md`.

После пятого push:

- `git rev-parse HEAD`;
- `git rev-parse origin/codex/capture-hotfix-mobile-first`;
- подтвердить равенство SHA;
- показать `git log --oneline -5`;
- показать `git status --short` и отдельно объяснить только pre-existing unrelated paths;
- **остановиться, не деплоить**.

## Definition of Done

- ровно пять новых implementation commits с указанными messages;
- каждый commit имеет один step-report и был запушен обычным push;
- active policy остаётся draft/closed, научные значения не выдуманы;
- ручных task/specimen/pH codes в operator flow нет;
- pH dropdown всегда требует нового выбора;
- quota/device/shared specimen logic server-validated;
- reaction начинает отдельная кнопка после reference;
- reshoot не удаляет history и не даёт двойной quota;
- blocking overlay/cancel/reconcile и polygon работают;
- original File не перекодируется;
- bounded ExifReader metadata сохраняется best-effort и не ломает upload;
- Admin summary полносерийный, exports воспроизводимы;
- одна Node process concurrency закрыта коротким локальным critical section;
- typecheck/build/focused tests зелёные;
- HEAD равен remote branch SHA;
- production не изменён.

## Финальный ответ нового треда

Коротко, но полностью сообщи:

1. пять commit SHA и messages;
2. какие наблюдаемые функции реализованы в каждом;
3. итоговый remote HEAD SHA;
4. выполненные checks и их результат;
5. точный policy status и какие поля ещё ожидают mini-research;
6. фактический runtime diff/stat и новые dependencies;
7. реальные ограничения/риски, особенно unknown EXIF coverage до физических телефонов;
8. подтверждение: push выполнен, deploy не выполнялся, production не изменён.

Не предлагай дополнительные фичи, roadmap или архитектурные улучшения. После этого остановись.
````
