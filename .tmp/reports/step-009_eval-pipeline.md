# Step 009 — Eval pipeline (blind set)
Дата: 2026-04-16

## Запрос / цель
Реализовать Step-009 из плана: добавить скрипт eval, который прогоняет blind set, считает метрики (Balanced Accuracy, recall по классам, coverage) и сохраняет отчёты.

## Понимание задачи
- Blind set фиксирован (10 фото) и не должен использоваться при калибровке.
- Eval должен выдавать:
  - сводные метрики,
  - таблицу ошибок (файл → истинный класс → предсказание),
  - удобный артефакт (JSON + Markdown) для обсуждения и итераций.

## План
1) Реализовать `scripts/pipeline/eval.ts`.
2) Добавить npm scripts в корень для удобства запуска.
3) Smoke‑запуск: ожидаемо упадёт, пока нет `calibration-v0.json` (и ROI‑разметки).

## Сделано
- Добавлен `scripts/pipeline/eval.ts`:
  - читает `manifest`, `blind-set`, `roi-labels`, `calibration`,
  - строит вектор признаков для каждого blind‑примера (через anchors),
  - считает Balanced Accuracy + recall по классам,
  - сохраняет отчёт в `data/eval/eval-v0.json` и `data/eval/eval-v0.md`.
- В `package.json` добавлены команды:
  - `npm run dataset:manifest`
  - `npm run pipeline:calibrate`
  - `npm run pipeline:eval`

## Изменённые файлы
- `scripts/pipeline/eval.ts`
- `package.json`
- `.tmp/reports/step-009_eval-pipeline.md`

## Команды (что запускалось)
```powershell
npm run pipeline:eval
```

## Риски / замечания
- Eval сейчас ожидает наличие `data/models/calibration-v0.json`; он появится после успешной калибровки (Step-008) и ROI‑разметки.
- В отчётах пишем CRLF, чтобы удобно открывалось в Windows.

## Следующие шаги
1) Разметить ROI (45 фото) → `data/dataset/roi-labels-v1.json`.
2) Запустить:
   - `npm run pipeline:calibrate`
   - `npm run pipeline:eval`
3) Сверить метрики с порогами MVP (BA ≥ 0.65 и ≥55% по каждому классу).

