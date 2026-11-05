# Deployment on the HocVPS server (Node + systemd)

The production instance runs on the shared CentOS 7 VPS (HocVPS script, nginx + PHP sites).
That host has no Docker or Coolify and its glibc (2.17) is too old for the official Node 22
binaries, so the app runs as a plain systemd service. SSH details live in the local, git-ignored
`.env.ssh`; runtime settings come from the git-ignored `.env.server`.

| What | Where on the server |
|---|---|
| Node 22 (unofficial `linux-x64-glibc-217` build) | `/opt/node22` |
| App code (`server/` + `web-app/` from `git archive HEAD`) | `/opt/study-planner` |
| Runtime env (copy of `.env.server`, LF line endings, mode 600) | `/etc/study-planner/study-planner.env` |
| systemd unit (runs as user `studyplanner`, sets `WEB_DIR`) | `/etc/systemd/system/study-planner.service` |
| SQLite database + automatic backups (`DATA_DIR`) | `/data`, `/data/backups` |

The app listens on port 3000. The server firewall (iptables) rejects that port from outside,
so public traffic comes through nginx.

## Public address: https://study.admirable.site

- DNS (Tenten, zone `admirable.site`): `A study → 66.42.50.130`. Only this record points here; the
  zone's `*` wildcard and other records stay on their own server.
- nginx vhost: `/etc/nginx/conf.d/study.admirable.site.conf`. Port 80 serves ACME challenges from
  `/var/www/acme` and redirects everything else to HTTPS; port 443 proxies to `127.0.0.1:3000` with
  `client_max_body_size 1100m` for zip restores.
- TLS: Let's Encrypt certificate issued by acme.sh (`/root/.acme.sh`, HTTP-01 webroot), installed
  to `/etc/nginx/ssl/study.admirable.site.{crt,key}`. The acme.sh root cron job renews it and
  reloads nginx. Check with `/root/.acme.sh/acme.sh --list`.

### Unused alternative: study.gomsuxaydung.vn

`/etc/nginx/conf.d/study.gomsuxaydung.vn.conf` is also configured (Cloudflare Origin wildcard
certificate `/etc/nginx/ssl/gomsuxaydung.crt`), but that subdomain has no DNS record. It only works
if a proxied Cloudflare record `A study → 66.42.50.130` is added to the `gomsuxaydung.vn` zone, and
Cloudflare's free plan would then cap uploads at 100 MB.

## Update the app

1. Locally: `git archive --format=tar.gz -o app.tgz HEAD server web-app`
2. Upload `app.tgz` to the server and extract it over `/opt/study-planner`.
3. `systemctl restart study-planner`
4. Check: `curl -s http://127.0.0.1:3000/api/health` returns 200.

`/data` is never touched by an update.

## Change settings

Edit `/etc/study-planner/study-planner.env` (keep LF line endings: a CRLF file puts a hidden
`\r` into values such as `APP_PASSWORD`), then `systemctl restart study-planner`.

## Logs

`journalctl -u study-planner -n 100 --no-pager`
