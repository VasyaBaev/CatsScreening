# Step 004 — Dataset manifest + blind split
Дата: 2026-04-16

## Запрос / цель
Реализовать Step-004 из плана: построить `manifest` по первой пачке фото в `sources/Photos/PH/` и сделать фиксированный blind split (≥10 фото) с seed.

## Понимание задачи
- `sources/` считаем read-only: не переносим и не переименовываем исходные фото.
- Нужен воспроизводимый список изображений с метаданными (pH, class, tray, light).
- Blind set нужен для последующей проверки метрик (Balanced Accuracy и др.).

## План
1) Сканировать `sources/Photos/PH` рекурсивно.
2) Извлечь `pH` из имени папки, `tray/light` из имени файла (эвристика).
3) Посчитать `class` по диапазону нормы 5.8–6.4 (включительно).
4) Сохранить JSON в `data/dataset/`.
5) Сформировать стратифицированный blind set 60/40 (6/4) по seed.

## Сделано
- Добавлен скрипт `scripts/dataset/build-manifest.ts`.
- Сгенерированы файлы:
  - `data/dataset/manifest-v1.json` (45 изображений, class0=30, class1=15)
  - `data/dataset/blind-set-v1.json` (10 изображений, class0=6, class1=4, seed=1337)

## Изменённые файлы
- `scripts/dataset/build-manifest.ts`
- `data/dataset/manifest-v1.json`
- `data/dataset/blind-set-v1.json`
- `.tmp/reports/step-004_dataset-manifest.md`

## Команды (что запускалось)
```powershell
npx tsx scripts/dataset/build-manifest.ts
```

## Риски / замечания
- Парсинг `tray/light` сделан эвристикой по имени файла и может давать `unknown` для нестандартных лотков (голубой/коричневый).
- Blind split стратифицированный (60/40), чтобы гарантировать оба класса в контрольной выборке; это немного отличается от “чистого” random split, но остаётся детерминированным по seed.

## Следующие шаги
1) Step-005: добавить инструмент разметки ROI (полуручно) и формат `roi-labels.json`.
2) Step-006+: добавить QC/признаки и скрипты калибровки/eval.

