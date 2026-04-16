# Step 001 — Bootstrap проекта (структура + boilerplate)
Дата: 2026-04-15

## Запрос / цель
Создать удобную стартовую структуру проекта “скрининг кошек по цвету наполнителя” и базовый boilerplate:
- Backend: Fastify + TypeScript.
- Frontend: React + TypeScript + Vite (включая `/admin` внутри того же приложения).
- Общие контракты: общий пакет со схемами (Zod).
- Оснастка агентской работы: `agent.md`, `AGENTS.md`, workflow, отчёты по шагам.
- Карта исследований + локальные копии материалов.
- Windows/PowerShell: UTF‑8 и CRLF фиксируем в конфиге.

## Понимание задачи
MVP (Этап 1) — web‑сервис скрининга (не диагноз):
- Пользователь: анкета → эталонное фото → диагностическое фото → результат (score/confidence + QC).
- Сервер: принимает данные, хранит кейсы, считает скоринг, возвращает результат.
- Админка: просмотр кейсов/поиск/выгрузка CSV.

## План
1) Создать структуру папок и базовые конфиги (UTF‑8/CRLF, prettier, tsconfig).
2) Добавить агентские правила и workflow выполнения шагов.
3) Создать карту исследований и локальные копии источников.
4) Скаффолд `packages/shared` и `packages/cv-core`.
5) Скаффолд `apps/api` (Fastify) и `apps/web` (React+Vite).
6) Проверить `typecheck` и `build`.

## Сделано
- Создана структура монорепозитория: `apps/*`, `packages/*`, `docs/*`, `.codex/*`, `.tmp/reports/*`.
- Добавлены базовые конфиги Windows‑среды:
  - `.editorconfig` (UTF‑8, CRLF),
  - `.gitattributes` (CRLF для текста, binary для картинок/docx),
  - prettier config с `endOfLine=crlf`.
- Добавлены агентские документы:
  - `agent.md`, `AGENTS.md`,
  - workflow: `.codex/workflows/skills-workflow.md`,
  - правило обязательных отчётов в `.tmp/reports/step-XXX_*.md`.
- Добавлена база знаний по исследованиям:
  - карта: `docs/research/research-map.md`,
  - локальные копии: `docs/research/papers/` (HTML/PDF) и `docs/research/notes/`.
- Скаффолд общих пакетов:
  - `packages/shared` — Zod‑схемы (метаданные/DTO),
  - `packages/cv-core` — заглушки QC (в будущем алгоритм).
- Скаффолд backend:
  - Fastify сервер, маршруты `/api/health` и `/api/cases` (POST, пока заглушка).
  - Prisma schema (dev: SQLite через `DATABASE_URL`).
- Скаффолд frontend:
  - React+Vite приложение, роуты `/` и `/admin` (заглушки),
  - `src/lib/api.ts` — клиент вызова `POST /api/cases`.

## Изменённые файлы
Ключевые файлы и точки входа:
- Root: `package.json`, `README.md`, `.env.example`, `.editorconfig`, `.gitattributes`, `.gitignore`, `tsconfig.base.json`.
- Agent/workflow: `AGENTS.md`, `agent.md`, `.codex/workflows/skills-workflow.md`.
- Research: `docs/research/research-map.md`, `docs/research/papers/*`, `docs/research/notes/*`.
- Backend: `apps/api/src/index.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/*`, `apps/api/prisma/schema.prisma`.
- Frontend: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/pages/*`, `apps/web/src/lib/api.ts`, `apps/web/vite.config.ts`.

## Команды (что запускалось)
- `npm install`
- `npm run typecheck`
- `npm run build`

## Риски / замечания
- `npm install` показал 2 moderate vulnerabilities в транзитивных зависимостях (см. `npm audit`).
- Prisma сейчас настроена на SQLite (dev). Для продакшна на Vercel потребуется переключение datasource на Postgres.
- Локальные копии исследований из PMC сохранены как HTML, т.к. прямое скачивание PDF упирается в защитный механизм (POW‑страница).

## Следующие шаги
1) Добавить реальную загрузку изображений (dev: multipart; prod: object storage) и хранение кейсов в БД.
2) Реализовать базовый QC (blur/glare/dark) и простой скоринг (reference→normalize→features→score).
3) Начать админку: список кейсов + CSV экспорт.
4) Описать Vercel‑деплой (переменные окружения, storage, маршрутизация).

