#!/usr/bin/env bash
set -euo pipefail

# Bootstrap VPS для CatsScreening.
#
# Скрипт рассчитан на чистый Ubuntu 24.04 VPS под root:
# - ставит Node.js 20 и Nginx;
# - создаёт системного пользователя без shell-доступа;
# - готовит директории релизов и persistent storage;
# - подключает systemd service и Nginx site.

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg nginx

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -qE '^v20\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! id catscreen >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/cats-screening --shell /usr/sbin/nologin catscreen
fi

mkdir -p /opt/cats-screening/releases
mkdir -p /var/lib/cats-screening/storage/uploads
mkdir -p /var/lib/cats-screening/.npm
chown -R catscreen:catscreen /var/lib/cats-screening
chown -R root:root /opt/cats-screening

install -m 0644 /tmp/cats-screening.service /etc/systemd/system/cats-screening.service

# Если Let's Encrypt уже выпустил сертификат, Nginx-конфиг мог быть расширен Certbot:
# там появляются HTTPS server-блоки, пути к сертификатам и HTTP->HTTPS redirect.
# Поэтому повторный bootstrap не должен молча затирать production HTTPS-конфигурацию
# базовым HTTP-шаблоном из репозитория.
nginx_site=/etc/nginx/sites-available/cats-screening.conf
if [ -f /etc/letsencrypt/live/cat-screening.tavela.co/fullchain.pem ]; then
  echo "Existing Let's Encrypt certificate detected; keeping current Nginx site config"
else
  install -m 0644 /tmp/cats-screening-nginx.conf "$nginx_site"
fi

# Временно закрываем пользовательский `/playground`, но оставляем статические
# `/playground/v5-v8/...` assets для внутренней ROI-разметки V5-V8.
if ! grep -q "location = /playground" "$nginx_site"; then
  python3 - "$nginx_site" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = "    location / {\n        try_files $uri /index.html;\n    }\n"
block = """    location = /playground {
        return 404;
    }

    location = /playground/ {
        return 404;
    }

"""
if needle not in text:
    raise SystemExit("Cannot patch Nginx config: location / block not found")
path.write_text(text.replace(needle, block + needle, 1))
PY
fi

ln -sfn "$nginx_site" /etc/nginx/sites-enabled/cats-screening.conf
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl daemon-reload
systemctl enable cats-screening.service
systemctl enable nginx
systemctl restart nginx

echo "CatsScreening VPS bootstrap complete"
