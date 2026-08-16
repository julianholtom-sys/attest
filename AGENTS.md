# Attest — agent handoff

Read this file and `docs/PROJECT_STATUS.md` at the start of any session on this repo.
Update both when product decisions, architecture, or demo access change, then commit and push.

## Product intent

- Local three-party e-sign (company / agency / supplier) for **Union Payroll** as the parent sender.
- Spec: `docs/esign-data-model.pdf` (Postgres/GCS in the brief → SQLite + local disk here).
- Brand source of truth: https://union-payroll.ltd/ (logo blue `#0074FF`, Manrope, white-text primary buttons).

## Current product shape

1. **Companies** — sending-company catalog; legal details + brand pack (front/back cover, logo).
2. **Templates** — one **master contract** (always sent) + optional **industry appendices** (upload/add/update).
3. **Contracts** (API still uses envelope tables/routes; UI always says contract) — pick sending company → master always included → optionally tick appendices → parties → bake → send → sequential sign.

## Stack

- Monorepo: `client/` (Vite React), `server/` (Express + `node:sqlite`).
- Data: `server/data/attest.sqlite`, files under `server/data/files/`.
- Prod-ish local: `npm run build && npm start` (API serves built UI on **8787**).

## Phone demo tunnel

- Cloudflare `*.trycloudflare.com` quick tunnels proved unreliable (HTTP 530 while process still “up”).
- Use `scripts/keep-tunnel-alive.sh` → **localhost.run** `*.lhr.life`.
- Live URL is written to `TUNNEL_URL.txt` (gitignored). Do not commit ephemeral URLs.
- **Persistence rule:** coding/commits must not restart the tunnel. Publishing to the live demo is explicit via `bash scripts/deploy-live.sh` (restarts API only; URL stays). One-time/recovery bring-up: `bash scripts/start-live.sh`.
- Watchdog must **not** recycle SSH while the local API is briefly down (deploys); only restart SSH if it died or public fails while local is healthy.

## Branch for local / PC access

**Use `main`.** Company setup, master+appendices, Union Payroll brand, tunnel scripts, and continuity docs are merged there. See `docs/PROJECT_STATUS.md` for detail. Older feature PRs #4/#5/#6 tip are historical.

## Continuity rule for agents

When ending a meaningful chunk of work: refresh `docs/PROJECT_STATUS.md` (what changed, what’s next, how to run/demo), commit, push. That is the cross-device source of truth—not chat history alone.

**Human shortcut:** in Agent chat type `/update-project-status` (skill + command in `.cursor/`). That runs the same “update status and push” workflow without retyping it.
