# CatsScreening
Веб‑сервис скрининга состояния кошки по фотографиям диагностического наполнителя (скрининг, не диагноз).

## Стек (MVP)
- Frontend: React + TypeScript + Vite
- Backend: Fastify + TypeScript (Node.js)
- Общие контракты: Zod‑схемы и типы в `packages/shared`
- Хранение кейсов: Prisma (в dev можно SQLite; в prod — Postgres)
- Обработка изображений: `sharp` (позже — алгоритм скоринга)

## Структура
- `apps/api` — backend API
- `apps/web` — web‑клиент (включая `/admin`)
- `packages/shared` — общие схемы/типы (DTO)
- `packages/cv-core` — “чистая” логика обработки/фич (без web/БД)
- `docs` — проектные заметки/протокол/исследования
- `sources` — исходные материалы (docx + фото)
- `.tmp/reports` — отчёты по шагам работы (step‑NNN)

## Workflow работы с агентом
- Правила: `agent.md` и `AGENTS.md`
- Описание обязательного сценария шага: `.codex/workflows/skills-workflow.md`

## Исследования (база знаний)
- Карта исследований: `docs/research/research-map.md`
- Локальные копии: `docs/research/papers/` и `docs/research/notes/`

## Где лежат фото
- pH‑датасет: `sources/Photos/PH/`

## Dataset pipeline (первые фото)
Документация: `docs/dataset/README.md`
Инструкция для заказчика: `docs/dataset/customer-roi-guide.md`

Быстрые команды:
- `npm run dataset:manifest` — пересобрать `manifest-v1.json` и `blind-set-v1.json`
- `npm run roi:start` — запустить локальную страницу ROI-разметки
- `npm run roi:check` — проверить полноту и корректность ROI-разметки
- `npm run roi:publish` — закоммитить и отправить ROI-разметку в GitHub
- `npm run pipeline:calibrate` — собрать `data/models/calibration-v0.json` (требует ROI разметку)
- `npm run pipeline:eval` — прогнать blind set и сохранить отчёт в `data/eval/`

## Запуск (после установки зависимостей)
Команды выполняются из PowerShell в корне проекта.

1) Установка зависимостей:
   - `npm install`
2) Запуск dev‑окружения:
   - `npm run dev`
3) Typecheck:
   - `npm run typecheck`
4) Build:
   - `npm run build`

## API (кратко)
- Документация эндпоинтов: `docs/api/endpoints.md`

## Важно про Windows / кодировку
- Файлы проекта ведём в UTF‑8.
- Для Windows/PowerShell фиксируем переносы строк CRLF (см. `.editorconfig`).
