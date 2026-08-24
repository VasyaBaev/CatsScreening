# Step 156 — Архив model sweep trace

Дата: 2026-08-24

## Запрос / цель

Сохранить большой `ph-v5-v9-model-sweep-inner.jsonl` в Git как компактный ZIP без возврата oversized blob в remote-safe историю.

## Понимание задачи

Архив нужен только как исторический research trace и не должен участвовать в runtime или deploy.

## План

Создать ZIP с одним исходным JSONL, проверить внутренний размер и SHA-256 потоком из архива, добавить краткую инструкцию восстановления и запушить отдельным commit.

## Сделано

- Создан `data/archive/ph-v5-v9-model-sweep-inner.jsonl.zip` размером `5053900` байт.
- ZIP содержит один файл размером `154589305` байт.
- SHA-256 распакованного потока совпал с исходным: `990ff3754d9560339233a50e44002a5358456a4c3114c52709f263d0ee0b4b99`.
- Исходные локальные копии и старая Git-история не изменялись.

## Изменённые файлы

- `data/archive/ph-v5-v9-model-sweep-inner.jsonl.zip`
- `data/archive/README.md`
- `.tmp/reports/step-156_model-sweep-trace-archive.md`

## Команды (что запускалось)

- `Compress-Archive`
- `Get-FileHash -Algorithm SHA256`
- read-only проверка ZIP через `System.IO.Compression.ZipFile`
- `git diff --check`

## Риски / замечания

Старые Stage 7/8 verification-команды ожидают raw JSONL в `data/eval`; перед их запуском архив требуется распаковать. Capture site от файла не зависит.

## Результат

Полный research trace сохранён в Git-совместимом архиве без oversized Git blob в ancestry новой ветки.
