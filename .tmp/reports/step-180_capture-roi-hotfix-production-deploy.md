# Step 180 — Capture ROI hotfix production deploy

Дата: 2026-08-25

## Запрос / цель

Развернуть на production утверждённый hotfix lifecycle после прохождения локальных проверок.

## Понимание задачи

- `RESULT`: production обслуживает проверенный runtime с отложенной ROI-разметкой.
- `IN SCOPE`: штатный Beget deploy, переключение release и безопасный production smoke.
- `OUT OF SCOPE`: активация V10 policy, изменение SOP и создание production attempts.
- `MODE`: full deploy.

## План

1. Сохранить точку отката и развернуть exact committed runtime.
2. Проверить service, API, Capture bundle и отсутствие изменения данных.
3. Сверить hashes ключевых runtime-файлов.

## Сделано

- Развёрнут runtime commit `9d44a79487a53cf676b85e9bf7de2a437a9375a3`.
- Production переключён на `/opt/cats-screening/releases/20260825212857`.
- Предыдущий release `/opt/cats-screening/releases/20260825194236` сохранён для отката.
- `cats-screening.service` перезапущен и активен; Nginx reload прошёл.
- Capture отдаёт bundle `index-iz-ktH6z.js` с новым lifecycle-текстом.
- Пять representative API/web runtime-файлов совпали с локальной сборкой по SHA-256.

## Изменённые файлы

- Production symlink `/opt/cats-screening/current` переключён на release `20260825212857`.
- В кодовой базе добавлен только этот deploy-report.

## Команды (что запускалось)

- `powershell -ExecutionPolicy Bypass -File deploy/beget/deploy.ps1`;
- public `GET /api/health`, `GET /api/cases/context`, `GET /api/admin/cases`;
- safe negative smoke `POST /api/cases/attempts` при draft policy;
- `GET /capture` и загрузка production JS asset;
- remote `readlink`, `systemctl is-active`, `journalctl` и `sha256sum`.

## Проверки

- Health: `200`, `{ "ok": true }`.
- Policy: `capture-v10@10.0-draft.1`, `status=draft`; pH/roles/quotas остаются пустыми.
- Create smoke: `409 CAPTURE_POLICY_DRAFT`; до и после запроса `attempts=0`, `cases=0`.
- Capture и новый JS asset: `200`; bundle содержит тексты отложенной ROI-разметки.
- Service: `active`; runtime errors на smoke-запросах отсутствуют.
- Локальные и production SHA-256 пяти runtime-файлов совпадают.

## Риски / замечания

- V10-съёмка намеренно закрыта до отдельного утверждения и deploy policy.
- Physical acceptance на реальных мобильных устройствах в этот hotfix не входит.
- `npm ci --omit=dev` повторно сообщил 9 audit warnings (`3 moderate`, `6 high`); dependency
  tree автоматически не изменялся.

## Результат

Production успешно обслуживает утверждённый Capture ROI lifecycle hotfix; данные не изменены,
точка отката сохранена.
