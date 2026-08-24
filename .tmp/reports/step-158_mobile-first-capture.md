# Step 158 — Mobile First Capture

Дата: 2026-08-24

## Запрос / цель

Подключить старый Capture UI к серверным заданиям и попыткам, сохранить оригинальные bytes фото и сделать основной flow пригодным для portrait-экранов iPhone/Samsung.

## Понимание задачи

```text
RESULT: оператор проходит task → slots → finalize на телефоне, а refresh восстанавливает сохранённую попытку
IN SCOPE: CapturePage, web API helper, capture-specific mobile-first CSS и browser QA
OUT OF SCOPE: Admin/Playground/ROI redesign, новая camera platform, offline storage, миграция legacy
MODE: full
```

## План

1. Подключить task/attempt/slot/finalize API без изменения старых helper-функций.
2. Заменить Canvas/base64 flow на исходный browser `File`, XHR byte progress и независимые состояния slots.
3. Добавить mobile-first layout и проверить два обязательных viewport в браузере.

## Сделано

- Task code загружает server-defined `sourcePh`, task type, specimen и динамический список slots; pH нельзя редактировать.
- Попытка сохраняет server `reactionStartedAt`; при отсутствии target/tolerance интерфейс честно показывает elapsed time без выдуманного countdown.
- Native `input type=file` с `accept="image/*"` и `capture="environment"` хранит исходный `File`; Canvas/base64 удалены.
- Raw PUT отправляет оригинал через `XMLHttpRequest`; проценты основаны только на `upload.onprogress`.
- Каждый slot имеет `empty/uploading/saved/error`, retry сохраняет выбранный файл, а уже готовые slots не сбрасываются.
- ROI сохраняется отдельно существующим `RoiEditor`; polygon на Capture скрыт без переписывания редактора.
- Attempt ID хранится в localStorage; refresh восстанавливает server-saved uploads и продолжает с первого незавершённого slot.
- Finalize поддерживает nullable `finalMixturePh`, отдельный blank flow, included/excluded и серверную идемпотентность.
- Capture CSS начинается с одной колонки 320–430 px; controls не меньше 44 px, inputs 16 px, placeholder нейтральный, desktop расширяется через `@media (min-width: 760px)`.
- Первоначально найденное перекрытие sticky action с select устранено: action оставлен в нормальном потоке.

## Изменённые файлы

- `apps/web/src/lib/api.ts`
- `apps/web/src/pages/CapturePage.tsx`
- `apps/web/src/styles.css`
- `.tmp/reports/step-158_mobile-first-capture.md`

Runtime net diff шага: 857 строк; три основных файла.

## Команды / проверки

- `npm run typecheck --workspace @cats-screening/web` — успешно.
- `npm run build --workspace @cats-screening/web` — успешно, Vite собрал 52 modules.
- Browser QA `360×800`: `scrollWidth=clientWidth=345`, horizontal overflow отсутствует, видимых controls ниже 44 px нет, inputs/selects 16 px.
- Browser QA `390×844`: `scrollWidth=clientWidth=375`, horizontal overflow отсутствует, видимых controls ниже 44 px нет, inputs/selects 16 px; нейтральный placeholder `rgb(238, 242, 234)`.
- Keyboard Enter выполнил task lookup; E2E прошёл create attempt → два binary upload → reload/resume → finalize.
- После reload сохранённый первый slot восстановился как `1 / 2`, текущим стал второй slot.
- Контрольный JPEG: source/upload по 16 578 bytes, SHA-256 совпал: `09E9702ECC6E55875973A90ED5010CF1DD531C78688E1A5209C27A3821243862`.
- Временные screenshots созданы вне репозитория и не коммитятся.
- QA attempt/uploads/manifest убраны из project storage в recoverable temp-каталог; исходные изображения не менялись.
- `git diff --check` — успешно.
- UTF-8/CRLF изменённых runtime-файлов — проверено, lone LF отсутствуют.

## Риски / замечания

- Локальные требования не содержат реальных target/tolerance для реакции, поэтому задания остаются untimed и UI показывает только прошедшее время.
- Несохранённый browser `File` после refresh нужно выбрать заново; server-saved slots восстанавливаются. Это согласованная граница без IndexedDB/offline-first.

## Результат

Mobile Capture работает поверх существующего Fastify/filesystem API, сохраняет исходные bytes и проходит обязательные mobile viewport и browser E2E проверки без изменения Admin, ROI labeling и Playground.
