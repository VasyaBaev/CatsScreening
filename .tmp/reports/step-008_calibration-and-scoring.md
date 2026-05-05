# Step 008 — Калибровка (kNN) + скоринг pH/score/confidence
Дата: 2026-04-16

## Запрос / цель
Реализовать Step-008 из плана: добавить сборку калибровки (feature vectors → JSON модель) и базовые функции скоринга (kNN pH_estimate → risk score/class + confidence).

## Понимание задачи
- Датасет `sources/Photos/PH` содержит одиночные кадры; на старте эмулируем `reference` через anchor внутри группы `(tray, light)`.
- Blind set должен быть исключён из калибровки, чтобы eval был честным.
- Скоринг должен быть объяснимым и лёгким для итераций: kNN на маленьком векторе признаков.

## План
1) Добавить в `cv-core` функции kNN и преобразования pH→score/confidence.
2) Написать скрипт `build-calibration`, который:
   - читает manifest/blind/roi-labels,
   - строит anchors по группам,
   - строит векторы признаков,
   - сохраняет `data/models/calibration-v0.json`.
3) Добавить placeholder `roi-labels-v1.json`, чтобы путь был фиксирован.
4) Проверить typecheck `cv-core`, smoke‑прогон скрипта (ожидаемо упадёт без ROI).

## Сделано
- В `packages/cv-core/src/index.ts` добавлено:
  - типы `KnnCalibrationModel`, `CalibrationVector`,
  - `knnPredict(...)`,
  - `classifyPh(...)`,
  - `riskScoreFromPh(...)`,
  - `confidenceFromKnn(...)`.
- Добавлен скрипт `scripts/pipeline/build-calibration.ts`.
- Добавлен placeholder `data/dataset/roi-labels-v1.json` (пустой, заполняется через ROI labeler).

## Изменённые файлы
- `packages/cv-core/src/index.ts`
- `scripts/pipeline/build-calibration.ts`
- `data/dataset/roi-labels-v1.json`
- `.tmp/reports/step-008_calibration-and-scoring.md`

## Команды (что запускалось)
```powershell
npm run typecheck --workspace packages/cv-core
npx tsx scripts/pipeline/build-calibration.ts
```

## Риски / замечания
- Без ROI-разметки калибровку построить нельзя (скрипт падает и показывает список файлов).
- kNN параметры (k, distanceScale) и пороги QC — MVP и будут уточняться после первого eval.

## Следующие шаги
1) Разметить ROI для 45 фото и сохранить `data/dataset/roi-labels-v1.json`.
2) Step-009: добавить `eval` скрипт и прогнать метрики на blind set.

