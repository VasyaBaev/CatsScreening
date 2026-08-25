# Step 178 — Capture V10 production deploy

Дата: 2026-08-25

## Запрос / цель

После независимой проверки заменить production проверенным Capture V10 hotfix.

## Понимание задачи

- `RESULT`: production обслуживает проверенный runtime из commit `c892c04`.
- `IN SCOPE`: штатный Beget deploy, переключение release, health/Context/Admin/Capture smoke и
  проверка runtime hashes.
- `OUT OF SCOPE`: активация V10 policy, научные значения SOP, массовая пересъёмка и physical QA.
- `MODE`: full deploy.

## План

1. Зафиксировать исходный release и health.
2. Развернуть exact committed runtime штатным script.
3. Проверить production поведение и совпадение артефактов.

## Сделано

- Исходный release: `/opt/cats-screening/releases/20260824220802`, service `active`.
- Развёрнут commit `c892c0482288d9a4ae791c438e7209dcb5cf5a5f`.
- Новый release: `/opt/cats-screening/releases/20260825194236`.
- `cats-screening.service` перезапущен и остаётся `active`; Nginx reload прошёл.
- Публичный Capture отдаёт новый bundle `index-DYeqQHeb.js`.
- Шесть representative shared/API/web runtime-файлов на VPS совпали с локальной сборкой по
  SHA-256.

## Изменённые файлы

- Production symlink `/opt/cats-screening/current` переключён на release `20260825194236`.
- Кодовая база в этом шаге не менялась; добавлен только этот отчёт.

## Команды (что запускалось)

- `powershell -ExecutionPolicy Bypass -File deploy/beget/deploy.ps1`;
- public `GET /api/health`, `GET /api/cases/context`, `GET /api/admin/cases`;
- safe negative smoke `POST /api/cases/attempts` при draft policy;
- `GET /capture` и загрузка его production JS asset;
- remote `readlink`, `systemctl is-active`, `journalctl` и `sha256sum`.

## Проверки

- Health: `200`, `{ "ok": true }`.
- Policy: `capture-v10@10.0-draft.1`, `status=draft`, `series=V10`.
- Policy scientific collections: source pH `0`, roles `0`, quotas `0`.
- Create smoke: `409 CAPTURE_POLICY_DRAFT`; после запроса Admin остаётся `cases=0`, `attempts=0`.
- Admin: отвечает, summary относится к `capture-v10@10.0-draft.1`.
- Capture: `200`; JS asset `200`, `292280` bytes.
- Service logs после старта не содержат runtime error на smoke-запросах.

## Риски / замечания

- Большая V10-съёмка намеренно закрыта до утверждения и commit/deploy научной policy.
- Physical acceptance на iPhone Safari, Samsung/Redmi Chrome и Android Firefox не выполнен.
- `npm ci --omit=dev` сообщил `9` audit warnings (`3 moderate`, `6 high`). Автоматический
  `npm audit fix` не выполнялся: состав предупреждений не удалось получить из-за timeout npm
  registry, а изменение dependency tree не относится к этому deploy.
- Точка отката сохранена: release `20260824220802` физически не удалён.

## Результат

Production успешно заменён release `20260825194236`; публичное поведение и runtime hashes
подтверждают развёртывание проверенного commit `c892c04`. Capture безопасно закрыт draft policy.
