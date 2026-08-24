# Step 154 — Guardrails и prompt для Capture hotfix + Mobile First

Дата: 2026-08-24

## Запрос / цель

Добавить в CatsScreening выборочную агентскую обвязку против лишних assumptions и overengineering, затем подготовить self-contained prompt для нового треда: старый простой сайт как baseline, только точечные новые функции, Mobile First для съёмки, commits/push и deploy.

## Границы

```text
RESULT: обновлённые project rules и готовый к запуску prompt следующей реализации
IN SCOPE: AGENTS.md, workflow, новый prompt, этот краткий отчёт, scoped commit и push
OUT OF SCOPE: runtime-код, данные, миграции, текущая незавершённая Capture v2 реализация, deploy
MODE: fast
```

## Факты

- В репозитории уже были `AGENTS.md` и `.codex/workflows/skills-workflow.md`; они дополнены, а не заменены чужой копией.
- Проверенный baseline `65d7976` содержит около 2003 строк в 10 основных Capture/Admin/API/storage/shared файлах.
- Текущая ветка `codex/production-like-capture-site` имеет многочисленные незавершённые runtime и пользовательские изменения; они не менялись и не включаются в commit этого шага.

## Сделано

- Добавлены scope card, классификация фактов/требований/допущений, запрет incidental scope creep и evidence gate.
- Зафиксированы практические SOLID/KISS/YAGNI, gate на новые зависимости/слои/хранилища, stop-budget и ограничение subagents/checks/reports.
- Уточнено, что migration/backward compatibility/legacy import выполняются только по прямому запросу.
- Создан новый prompt с отдельным worktree от `65d7976`, фиксированными пятью commits, Mobile First критериями, политикой fresh-series без migration и существующим Beget deploy.
- Старый production prompt и runtime-код не редактировались.

## Изменённые файлы

- `AGENTS.md`
- `.codex/workflows/skills-workflow.md`
- `docs/pipeline/next-thread-prompt-capture-v2-hotfix-mobile-first.md`
- `.tmp/reports/step-154_capture-v2-scope-guardrails-and-hotfix-prompt.md`

## Проверки

- Prettier check для четырёх Markdown-файлов.
- `git diff --check` для точного scope.
- Проверка UTF-8, CRLF, завершающего перевода строки и Markdown fences.
- Просмотр staged diff перед commit; staging только по четырём явным pathspec.
- Runtime tests/build не запускались: runtime-код не менялся.

## Риски / замечания

- Новый prompt сознательно не использует незавершённую Capture v2 архитектуру; он создаёт отдельный worktree от старого простого baseline и сохраняет текущую ветку.
- Legacy архив не удаляется и не мигрируется. Новая серия использует старые данные как read-only историю только при нулевой стоимости совместимости; иначе стартует пустой.

## Результат

Следующий тред получает committed project rules и однозначный ограниченный prompt: пять фиксированных шагов без новых подсистем, затем push и deploy exact SHA.
