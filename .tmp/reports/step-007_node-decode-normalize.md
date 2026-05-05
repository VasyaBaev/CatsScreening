# Step 007 — Node decode + нормализация (rotate EXIF + resize + WB optional)
Дата: 2026-04-16

## Запрос / цель
Реализовать Step-007 из плана: добавить декодирование изображений на Node (JPEG/PNG/HEIC при наличии) и нормализацию (каноническая геометрия + опциональный white-balance по reference ROI).

## Понимание задачи
- `cv-core` не должен содержать I/O и зависеть от библиотек декодирования.
- Для дальнейших скриптов (калибровка/eval) нам нужен единый формат пикселей: RGB (sRGB) `Uint8Array`.
- Нормализация должна быть воспроизводимой: rotate EXIF + resize до фиксированной ширины без апскейла.

## План
1) Добавить Node-утилиту `loadImageAsRgb(...)` на базе `sharp`.
2) Добавить нормализацию пары `reference+diagnostic` и опциональный white-balance по ROI.
3) Подключить зависимость `sharp` в workspace.
4) Smoke‑проверка чтения 1 файла из `sources/Photos/PH`.

## Сделано
- Добавлено:
  - `scripts/lib/image-io.ts` — `loadImageAsRgb(...)` (rotate EXIF + resize + sRGB).
  - `scripts/lib/normalize.ts` — `loadAndNormalizePair(...)` + `estimateWhiteBalanceGains(...)` + `applyWhiteBalance(...)`.
- Установлена зависимость `sharp` в `apps/api` (hoisted в workspace).
- Smoke‑проверка: декодирование одного JPEG из `sources/Photos/PH` успешно.

## Изменённые файлы
- `scripts/lib/image-io.ts`
- `scripts/lib/normalize.ts`
- `apps/api/package.json`
- `package-lock.json`
- `.tmp/reports/step-007_node-decode-normalize.md`

## Команды (что запускалось)
```powershell
npm install --workspace apps/api sharp
npx tsx -e "import { loadImageAsRgb } from './scripts/lib/image-io.ts'; (async () => { const img = await loadImageAsRgb('sources/Photos/PH/6/(6) окно  белый.jpg', { targetWidth: 256 }); console.log({ w: img.width, h: img.height, len: img.data.length }); })()"
```

## Риски / замечания
- `sharp` — нативная зависимость (бинарники). Обычно работает на Windows и Vercel, но может потребовать внимания при CI/деплое.
- White-balance — “мягкая” эвристика; включать по умолчанию в проде будем только после проверки на данных.

## Следующие шаги
1) Step-008: реализовать калибровку (kNN) и скоринг `pH_estimate/score/confidence`.
2) Step-009: eval на blind set и таблица ошибок.

