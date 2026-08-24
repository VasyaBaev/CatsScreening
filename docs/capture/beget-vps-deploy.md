# Beget VPS deploy

Дата: 2026-07-02

## Сервер

| Параметр | Значение |
|---|---|
| IP | `155.212.128.62` |
| Domain | `cat-screening.tavela.co` |
| OS | Ubuntu 24.04.4 LTS |
| SSH user | `root` |
| SSH key | `C:\Users\ASM\.ssh\cats_screening_beget_ed25519` |

Пароль root не сохраняется в проекте. Подключение по SSH-ключу проверено.

## Архитектура pilot deployment

| Компонент | Где работает |
|---|---|
| Web | Nginx static files из `/opt/cats-screening/current/apps/web/dist` |
| API | systemd service `cats-screening.service`, Node.js на `127.0.0.1:3001` |
| Upload storage | `/var/lib/cats-screening/storage/uploads` |
| Case manifest | `/var/lib/cats-screening/storage/cases.jsonl` |
| Reverse proxy | Nginx `/api/* -> 127.0.0.1:3001` |
| Public URL | `https://cat-screening.tavela.co` |

## Локальный деплой

```powershell
powershell -ExecutionPolicy Bypass -File deploy/beget/deploy.ps1
```

Скрипт:

1. запускает `npm run playground:build`;
2. запускает `npm run build`;
3. собирает runtime archive;
4. отправляет архив на VPS;
5. запускает server bootstrap при необходимости;
6. устанавливает production dependencies;
7. переключает `/opt/cats-screening/current`;
8. перезапускает API и Nginx.

## Проверка

```powershell
ssh -i "$env:USERPROFILE\.ssh\cats_screening_beget_ed25519" root@155.212.128.62 "systemctl status cats-screening --no-pager"
curl https://cat-screening.tavela.co/api/health
```

## Домен и HTTPS

Домен `cat-screening.tavela.co` направлен A-записью на `155.212.128.62`.

HTTPS выпускается на VPS через Let's Encrypt / Certbot. Если сертификат уже выпущен в панели хостинга отдельно, он не нужен для этого сценария: серверу потребовались бы и публичная цепочка сертификатов, и приватный ключ. Certbot проще, потому что сам проверяет домен, кладет сертификаты в `/etc/letsencrypt/live/cat-screening.tavela.co/` и обновляет Nginx.

После выпуска сертификата `deploy/beget/setup-server.sh` не перезаписывает существующий HTTPS-конфиг базовым HTTP-шаблоном.

Текущий статус на 2026-07-02:

- HTTPS активен на `https://cat-screening.tavela.co`.
- HTTP автоматически перенаправляет на HTTPS.
- Certbot timer активен, сертификат должен обновляться автоматически.
- `certbot renew --dry-run` проходит успешно.
- Текущий сертификат Let's Encrypt действителен до 2026-09-30.
