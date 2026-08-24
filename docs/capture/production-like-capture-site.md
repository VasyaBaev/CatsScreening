# Production-like capture site

Дата: 2026-06-28

## Что собрано

Ветка `codex/production-like-capture-site` добавляет локально запускаемый capture site для сбора production-like paired ground-truth датасета.

Сценарий данных:

1. Оператор открывает `/capture`.
2. Выбирает серию, устройство, условия съёмки и точный diagnostic pH.
3. Загружает `reference` фото.
4. Загружает `diagnostic` фото.
5. Сохраняет пару.
6. API сохраняет изображения и manifest.
7. `/admin` показывает последние пары, счётчики по band и export links.

Сайт не показывает диагноз и не запускает production-модель. Эта версия нужна для сбора обучающих данных.

## Поведение формы

- `Operator` сохраняется в `localStorage` браузера и автоматически подставляется при следующем открытии формы на этом же устройстве.
- `Device` сначала подставляется из browser `userAgent/userAgentData`; поле остаётся редактируемым, и ручная правка тоже сохраняется локально.
- В UI есть одно поле света — `Lighting`. Техническое поле manifest `light = day | 3000K | 6000K` вычисляется автоматически из `Lighting`, поэтому отдельного `Base light` в форме нет.
- Кнопки `?` рядом с `Lighting` и `Distance` раскрывают расшифровку условий.
- Кнопка `Open camera` использует `<input type="file" accept="image/*" capture="environment">`; на мобильных браузерах это должно открывать камеру или системный выбор камера/галерея, в зависимости от браузера и ОС.

## Расшифровка distance

| Distance | Смысл |
|---|---|
| `Normal` | примерно 35-45 см, наполнитель занимает большую часть кадра и не обрезан |
| `Slightly near` | примерно 25-35 см, ближе обычного, но вся нужная область всё ещё видна |
| `Slightly far` | примерно 45-60 см, видно больше фона/лотка, но наполнитель остаётся читаемым |

## Локальный запуск

PowerShell:

```powershell
npm install
npm run dev
```

После запуска:

- UI: `http://127.0.0.1:5173/capture`
- Admin: `http://127.0.0.1:5173/admin`
- API health: `http://127.0.0.1:3001/api/health`

Для локального режима не задавайте `DATABASE_URL`. Тогда API пишет manifest в локальный JSONL fallback. Если нужно временно перенести локальное хранилище, задайте `LOCAL_CAPTURE_STORAGE_DIR`.

## Локальное хранение

Файлы:

| Путь | Назначение |
|---|---|
| `apps/api/storage/uploads/` | локальные JPEG/PNG/WebP uploads |
| `apps/api/storage/cases.jsonl` | локальный manifest пар |
| `apps/api/storage/.gitkeep` | placeholder для git |
| `LOCAL_CAPTURE_STORAGE_DIR` | опциональный override пути локального хранилища |

`uploads/` и `cases.jsonl` не коммитятся. Они нужны только для локального smoke test и временного сбора.

## API endpoints

| Endpoint | Назначение |
|---|---|
| `POST /api/uploads/image` | загрузить одно изображение как base64 JSON |
| `GET /api/uploads/local/*` | открыть локальное изображение по storage key |
| `POST /api/cases` | сохранить пару `reference + diagnostic` |
| `GET /api/admin/cases` | список кейсов из Postgres или local JSONL |
| `GET /api/admin/export.csv` | CSV export для ручного контроля |
| `GET /api/admin/export.jsonl` | JSONL export для ML-pipeline/catalog builder |

## Manifest contract

Кейс сохраняет:

- `series`
- `pairId`
- `captureMode = production_like_lab_ground_truth`
- `operatorId`
- `device`
- `referencePh`
- `diagnosticPh`
- `diagnosticBand = low | normal | high`
- `condition.lightLabel`
- `condition.angleLabel`
- `condition.distanceLabel`
- `capture.referenceCapturedAt`
- `capture.diagnosticCapturedAt`
- `capture.captureDeltaSeconds`
- `client.userAgent`
- `client.viewport`
- `images[].kind`
- `images[].uri`

`class` вычисляется из `diagnosticBand`: `normal -> 0`, `low/high -> 1`.

## pH grid

Текущая сетка UI:

| Band | pH |
|---|---|
| Low | 4.0, 4.6, 5.4, 5.6 |
| Normal | 5.8, 6.13, 6.4 |
| High | 6.6, 6.8, 7.0, 7.8 |

Нормальное окно в коде: `5.8..6.4`. Оно задано в `derivePhBand()` внутри `packages/shared/src/index.ts`.

## Что готово к деплою

Уже готово:

- Vite frontend route `/capture`.
- API upload contract.
- API case manifest contract.
- Local fallback без Postgres.
- Admin counters и export.
- `vercel.json` уже содержит сборку frontend и `/api/*` adapter для существующей архитектуры.

Что подключить после credentials:

| Слой | Сейчас | После credentials |
|---|---|---|
| Image storage | `apps/api/storage/uploads` | Cloudflare R2 или Vercel Blob |
| Case metadata | `apps/api/storage/cases.jsonl` без `DATABASE_URL` | Postgres через `DATABASE_URL` |
| Upload pattern | base64 JSON в API | signed direct upload в object storage |
| Export | API читает local JSONL или Postgres | API читает Postgres + object keys |

## Credentials, которые понадобятся позже

Минимально:

- hosting account: Vercel или Cloudflare Pages;
- Postgres `DATABASE_URL`, если хотим хранить manifest в БД;
- object storage credentials для R2/Vercel Blob;
- deploy env vars в выбранном провайдере.

Для первой локальной проверки credentials не нужны.

## Ограничения текущей версии

- EXIF не извлекается отдельной библиотекой; сохраняются `userAgent`, `viewport` и операторские labels.
- Локальный upload через base64 JSON не является финальным production upload pattern.
- Нет авторизации; перед внешним доступом нужен хотя бы shared secret/basic auth/allowlist.
- Нет quotas UI по конкретным pH; пока есть только counters по band в `/admin`.
- Нет автоматического качества кадра, только текущая заглушка QC.

## Следующий деплой-шаг

Когда credentials будут готовы:

1. Выбрать storage: Cloudflare R2 или Vercel Blob.
2. Добавить production upload adapter.
3. Добавить минимальную авторизацию для `/capture` и `/admin`.
4. Настроить env vars в hosting provider.
5. Прогнать smoke test на 3-5 парах.
6. Выдать заказчику закрытую ссылку и pH/condition quota table.
