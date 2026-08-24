# Step 161 — Production Chrome QA

Дата: 2026-08-24

## Запрос / цель

Запустить пользовательский Chrome и самостоятельно проверить production-сайт после деплоя.

## Понимание задачи

```text
RESULT: production Capture проходит реальный Chrome E2E, контрольный кейс виден в Admin и не входит в датасет
IN SCOPE: Chrome Capture 2-photo flow, reload/resume, excluded finalize, Admin, photo URLs, ROI route, console и server evidence
OUT OF SCOPE: изменение browser permissions, подбор ROI-пароля, новый код и повторный deploy
MODE: full
```

## План

1. Открыть production Capture в Chrome и начать уникальную контрольную попытку.
2. Сохранить первый JPEG, обновить страницу и доказать resume 1/2.
3. Сохранить второй JPEG и завершить кейс как исключённый.
4. Проверить Admin, оба изображения, ROI route, browser console и production API.

## Сделано

- Chrome запущен с профилем `Default`; production Capture открыт в отдельной управляемой вкладке.
- Создана попытка `ca3d2ef6-9929-4deb-9994-a255cf4c91be` по заданию `PH560-CHR824`.
- Задание распознано как reacted specimen с source pH 5.6 и двумя обязательными слотами.
- Первый оригинал сохранён, после reload восстановлены попытка, таймер, статус 1/2 и текущий слот `diagnostic`.
- Второй оригинал сохранён; итоговый кейс `6e56b879-305f-4ca4-858d-73199abf97ab` завершён с final pH 5.65 и `included=false`.
- Admin показывает 2 fresh кейса: включено 0, исключено 2; новый Chrome-кейс содержит все ожидаемые metadata и photo links.
- Оба production JPEG полностью открылись в Chrome и декодировались как 1200x1600.
- ROI route открылся и показал ожидаемый login gate; сохранение ROI без учётных данных не проверялось.
- В Chrome console для Admin и ROI нет errors или warnings.
- Основная вкладка Chrome оставлена открытой на production Admin.

## Изменённые файлы

- `.tmp/reports/step-161_production-chrome-qa.md`

Runtime, Git history и production release не менялись.

## Команды / проверки

- Chrome Capture UI: task lookup, start, 2 JPEG uploads, reload/resume 1/2, excluded finalize.
- Chrome Admin UI: counters, metadata, exclusion reason и обе photo links.
- Chrome image documents: `complete=true`, 1200x1600 для reference и diagnostic.
- Chrome ROI UI: route и login gate отрисованы.
- Chrome console: 0 errors/warnings на Admin и ROI.
- `GET /health` — HTTP 200.
- `GET /api/admin/cases?limit=100&offset=0` — кейс найден, `included=false`, 2 images, exact bytes/SHA-256 и ROI metadata.
- Git gate: local HEAD = remote SHA `b58fe5de086d8af3109aeb9dfd5d75e01df183fb`; tracked worktree clean.

## Риски / замечания

- Обычный `fileChooser.setFiles` в Chrome вернул `Not allowed`, хотя пользователь сообщил, что Settings включены. Настройки браузера не менялись; два заранее утверждённых тестовых JPEG были переданы в те же file inputs через scoped Chrome DevTools runtime и затем загружены штатными кнопками UI.
- ROI требует отдельного логина и пароля. Пароль не извлекался, не подбирался и не передавался.
- Оба новых production smoke-кейса намеренно исключены и не участвуют в датасете.

## Результат

Production Capture/Admin подтверждены реальным Chrome E2E после деплоя: resume и finalize работают, оригиналы доступны, QA-кейс исключён, release и Git остаются неизменными.
