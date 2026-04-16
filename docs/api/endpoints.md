# API Endpoints (MVP)

Базовый префикс: `/api`

## Health
- `GET /api/health`
  - Ответ: `{ "ok": true }`

## Кейсы
- `POST /api/cases`
  - Назначение: создать кейс скрининга (метаданные + ссылки на изображения).
  - Примечание: на текущем этапе `images[].uri` — это строковые ключи/URI, а не байты файлов.

Пример (PowerShell):

```powershell
$body = @{
  metadata = @{
    pH = $null
    class = $null
    tray = "white"
    light = "day"
    location = "home_bath"
    device = $null
    notes = $null
  }
  images = @(
    @{ kind = "reference"; uri = "ref://example" }
    @{ kind = "diagnostic"; uri = "diag://example" }
  )
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3001/api/cases" -ContentType "application/json" -Body $body
```

## Analyze (dev)
- `POST /api/analyze`
  - Назначение: прогнать пайплайн анализа для пары `reference+diagnostic` по ROI и получить `pH_estimate/score/confidence`.
  - Важно: на текущем этапе эндпоинт читает изображения по локальным путям внутри репозитория (MVP/dev).

Пример (PowerShell):

```powershell
$body = @{
  referenceUri  = "sources/Photos/PH/6/(6) окно  белый.jpg"
  diagnosticUri = "sources/Photos/PH/7,8/(7,8) окно серый.jpg"
  roi = @{
    x = 0.1
    y = 0.2
    w = 0.6
    h = 0.4
  }
  debug = $true
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3001/api/analyze" -ContentType "application/json" -Body $body
```

## Админка
Внимание: на текущем этапе эндпоинты админки **без авторизации**.

- `GET /api/admin/cases?limit=50&offset=0`
  - Возвращает список кейсов (последние сверху) + простую пагинацию.

- `GET /api/admin/export.csv`
  - Возвращает CSV выгрузку всех кейсов.
