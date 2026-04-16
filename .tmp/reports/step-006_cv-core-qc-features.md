# Step 006 — cv-core: QC + признаки (HSV/Lab)
Дата: 2026-04-16

## Запрос / цель
Реализовать Step-006 из плана: добавить в `packages/cv-core` QC‑проверки и извлечение признаков из ROI, чтобы дальше использовать их в калибровке и скоринге.

## Понимание задачи
- `cv-core` должен быть “чистым”: без сети, без БД, без Fastify/HTTP, без I/O.
- QC и признаки нужны как для UX (просить переснять), так и для confidence/метрик.
- Признаки должны быть устойчивыми: работаем через дельту diagnostic − reference и используем HSV Hue + Lab a/b.

## План
1) Ввести типы `RgbImage` и `RoiRect`.
2) Реализовать QC на ROI (dark/glare/blur) с метриками.
3) Реализовать извлечение признаков ROI (mean HSV + mean Lab + hueVector).
4) Реализовать delta‑признаки и сборку feature vector для kNN.
5) Прогнать TypeScript typecheck.

## Сделано
- В `packages/cv-core/src/index.ts` добавлены:
  - `RgbImage`, `RoiRect`,
  - `runQualityChecksForRoi(...)` → `{ flags, metrics }`,
  - `extractRoiFeatures(...)`,
  - `computeDeltaFeatures(...)`,
  - `buildFeatureVector(...)`.
- Пороговые значения QC заданы как MVP‑эвристики (будут уточняться по данным).

## Изменённые файлы
- `packages/cv-core/src/index.ts`
- `.tmp/reports/step-006_cv-core-qc-features.md`

## Команды (что запускалось)
```powershell
npm run typecheck --workspace packages/cv-core
```

## Риски / замечания
- Пороги QC пока “инженерные” и требуют подстройки на данных (особенно blurScore).
- Признаки пока усредняющие; возможно потребуется более “робастный” отбор пикселей/маска (будет видно на eval).

## Следующие шаги
1) Step-007: декодирование/нормализация изображений на Node (rotate EXIF + resize).
2) Step-008: калибровка kNN и реализация скоринга.

