# Step 002 — Vercel (free): деплой‑план + `/api` adapter + Postgres schema
Дата: 2026-04-16

## Запрос / цель
Сделать второй шаг:
- Зафиксировать план деплоя на Vercel (free).
- Добавить адаптер, чтобы Fastify API работал на Vercel под `/api/*`.
- Перевести хранение кейсов на Postgres (Prisma Schema).
- Описать стратегию хранения изображений (object storage / Blob).
- Оформить отчёт шага.

## Понимание задачи
Нам нужен деплой “одним доменом”:
- UI — статический SPA (Vite build) с роутами `/` и `/admin`.
- API — serverless функции Vercel, обслуживающие `/api/*`.

Ограничения serverless учитываем заранее:
- нельзя `listen()` на Vercel,
- запросы с крупными файлами нежелательны (в будущем — direct upload в object storage).

## План
1) Добавить `vercel.json` и ADR с инструкциями деплоя.
2) Добавить serverless handler `api/[...path].ts`, который проксирует запросы в Fastify.
3) Перевести Prisma schema на Postgres и расширить модели под JSON‑метаданные и QC.
4) Подключить Prisma Client и сохранять кейсы в БД в `POST /api/cases`.
5) Прогнать `typecheck/build`.

## Сделано
- Добавлен Vercel‑конфиг:
  - `vercel.json` с build/output для Vite и SPA‑fallback rewrite (исключая `/api/*`).
  - `tsconfig.vercel.json` для typecheck serverless‑функций.
- Добавлен Vercel serverless‑адаптер:
  - `api/[...path].ts` создаёт Fastify‑приложение через `buildServer()` и прокидывает `req/res`.
- Добавлены ADR:
  - `docs/adr/adr-001_vercel-deploy.md` — как деплоить и что проверять.
  - `docs/adr/adr-002_storage-postgres-blob.md` — Postgres + object storage (Blob) как стратегия.
- Prisma schema переведена на Postgres:
  - datasource provider = `postgresql`
  - `Case.metadata` и `Case.qc` — JSON
  - `CaseImage.kind` — enum (`reference|diagnostic`)
- В API подключён Prisma Client singleton:
  - `apps/api/src/services/prisma.ts`
- В `POST /api/cases` добавлено сохранение кейса в БД:
  - создаётся `Case` + связанные `CaseImage[]`
  - пока сохраняем только URI/ключи изображений (без загрузки байтов)
- Проверено:
  - `npm run typecheck`
  - `npm run build`
 - Добавлен скрипт миграций для прод‑окружения:
   - `npm run prisma:migrate:deploy --workspace apps/api`

## Изменённые файлы
- Vercel:
  - `vercel.json`
  - `api/[...path].ts`
  - `tsconfig.vercel.json`
- ADR:
  - `docs/adr/adr-001_vercel-deploy.md`
  - `docs/adr/adr-002_storage-postgres-blob.md`
- Prisma/DB:
  - `apps/api/prisma/schema.prisma`
  - `apps/api/package.json`
  - `apps/api/src/services/prisma.ts`
  - `apps/api/src/routes/cases.ts`
  - `.env.example`
- Scripts:
  - `package.json` (typecheck дополняется проверкой serverless‑функций)

## Команды (что запускалось)
- `npm run prisma:generate --workspace apps/api`
- `npm run typecheck`
- `npm run build`

## Риски / замечания
- Для реального запуска API нужен валидный `DATABASE_URL` (Postgres).
- Загрузка оригинальных фото через API на Vercel будет ограничена — в будущем нужен direct upload в object storage.
- В схемах/эндпоинтах пока нет авторизации для `/admin` (это отдельная задача).

## Следующие шаги
1) Добавить минимальную админ‑часть API: список кейсов + CSV экспорт.
2) Добавить нормальную схему загрузки изображений:
   - dev: multipart upload → локальное хранилище,
   - prod: direct upload в object storage → API получает только ключи.
3) Начать реализацию QC (blur/glare/dark) и базового скоринга.
