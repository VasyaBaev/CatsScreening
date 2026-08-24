# Step 155 — Capture hotfix guardrails

Дата: 2026-08-24

## Запрос / цель

Подготовить remote-safe ветку на основе site/runtime-среза baseline `65d7976` и сохранить актуальные ограничения поставки Capture hotfix.

## Понимание задачи

Runtime на этом шаге не меняется. Исходная dirty-ветка и контрольный baseline-worktree должны остаться нетронутыми.

## План

Перенести только `AGENTS.md`, обязательный workflow и актуальный delivery prompt, затем проверить границы diff.

## Сделано

- После разрешённого пользователем обхода GitHub-лимита опубликован runtime snapshot `78eb02b` без oversized research history.
- Перенесены актуальные правила KISS/YAGNI, запрет scope creep, миграции и compatibility без прямого запроса.
- Перенесён фиксированный prompt для пяти шагов hotfix и Beget deploy.

## Изменённые файлы

- `AGENTS.md`
- `.codex/workflows/skills-workflow.md`
- `docs/pipeline/next-thread-prompt-capture-v2-hotfix-mobile-first.md`
- `.tmp/reports/step-155_capture-hotfix-guardrails.md`

## Команды (что запускалось)

- `git status --short --branch`
- `git diff --check`
- точное сравнение перенесённых файлов с исходным деревом

## Риски / замечания

Ветка не имеет прямого ancestry от `65d7976` по явному разрешению пользователя, но рабочие site/runtime-файлы взяты из этого commit. Исследовательские артефакты и `sources/` исключены.

## Результат

Remote-safe ветка содержит актуальную агентскую обвязку и готова к точечным runtime hotfixes.
