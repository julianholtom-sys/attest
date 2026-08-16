# Attest — project status

Last updated: 2026-08-16 ~11:40 UTC

This file is the **cross-device continuity log**. Chat history does not reliably travel between phone and desktop agents. Keep this (and `AGENTS.md`) current in git.

## What this is

Local Attest e-sign app implementing the three-party data model from `docs/esign-data-model.pdf`, without Google/GCS:

| Brief | Local |
| --- | --- |
| Postgres | SQLite (`server/data/attest.sqlite`) |
| GCS | `server/data/files/**` |
| Google Identity | Seeded local admin user |
| Transactional email | Local outbox table |

Parent brand / sending company context: **Union Payroll** — https://union-payroll.ltd/

## Working product model

### Nav order

**Companies → Templates → Contracts** (+ New contract)

### Companies

- Many defined sending companies (seed includes Union Payroll + demo companies).
- Company setup holds legal profile and **brand pack** (front cover, back cover, logo).
- Creating a contract picks a sending company from that catalog; covers/logo auto-apply from that company on bake.
- **Delete company** on the list and setup pages, with an in-app **Are you sure?** dialog (Cancel / Yes, delete). Soft-delete (`is_active = 0`); existing contracts stay on file.
- **Introductory email** — paste/save Gmail intro text per company; **Copy intro email**.
- **Gmail signature file** — PNG/JPG uploaded from the local PC into `server/data/files` (not fetched from Google or a company mail server). Stored as asset kind `email_header`.

### Templates

- **One master contract** — always included on every contract.
- **Industry appendices** — optional; chosen per contract (not auto-all for an industry).
- Templates UI supports upload/update for master PDF and add/update/replace for appendices.

### Contracts

- UI word is **contract** everywhere staff see it. Internal API/SQLite still use `envelopes`.
- Draft → bake → ready → send → sequential sign → completed.
- Company role has evidence gate before signature.
- Hash-chained audit events; baked PDF on disk.

## Brand / UI

- Accent: Union Payroll logo blue **`#0074FF`**, primary buttons white text.
- Font: **Manrope**.
- Header: Union Payroll mark + “Attest contracts”.
- Assets: `client/public/union-payroll-logo.png`.
- Do **not** restyle toward Media Launch; that was a mistaken brand pass before the Union Payroll URL was provided.

## How to run

```bash
npm install
npm run build
npm start          # http://localhost:8787
```

On **Windows**, `npm start` fails because `server` uses `NODE_ENV=production node …`. Use PowerShell: `$env:NODE_ENV='production'; node src/index.js` from `server/`, or `npm run dev`.

Dev split: `npm run dev` (API 8787, Vite 5173).

### Phone / public demo (persistent workflow)

```bash
# One-time / recovery (starts API + tunnel)
bash scripts/start-live.sh
cat TUNNEL_URL.txt           # gitignored; do not commit

# Publish code changes WITHOUT changing the public URL
bash scripts/deploy-live.sh
```

Rules of the road:

- Prefer **localhost.run** `*.lhr.life` via `scripts/keep-tunnel-alive.sh`.
- Do **not** use Cloudflare `*.trycloudflare.com` quick tunnels.
- **Do not** kill/restart the tunnel during normal coding or status commits.
- Watchdog holds SSH open while local API is down (deploys); only recycles SSH if the process dies or public fails while local is healthy.
- “No tunnel here” = stale hostname after an SSH recycle — read a fresh URL from `TUNNEL_URL.txt`.
- Anonymous `*.lhr.life` hostnames still change if SSH itself dies; for a forever-stable host, add a named Cloudflare tunnel or localhost.run forever-free + SSH key later.

## Continuity tooling

- `AGENTS.md` — short agent briefing (read at session start).
- `docs/PROJECT_STATUS.md` — this log.
- `.cursor/rules/attest-continuity.mdc` — always-apply: Union Payroll brand + protect live tunnel + deploy-live only.
- **`/update-project-status`** — Agent slash command + skill to refresh these docs and push.

## Recent work stream (high level)

1. Local Attest stack from e-sign data model (SQLite + disk).
2. Auto covers / logo / industry appendices at bake.
3. Company setup catalog + sending-company dropdown on create.
4. Restructure to master contract + selectable industry appendices; upload/update UI.
5. Restyle to Union Payroll brand (after correcting mistaken Media Launch pass).
6. Phone tunnel: Cloudflare → localhost.run watchdog.
7. Cross-device continuity docs + Cursor rule.
8. Persistent `/update-project-status` slash command/skill.
9. Live demo persistence: `deploy-live.sh` / `start-live.sh`; watchdog ignores local downtime so URL does not change on every edit.
10. Company delete + confirm dialog; per-company intro email + local Gmail signature image; UI copy uses **contract** not envelope.

## Active git / PR notes

- Feature branch naming: `cursor/<name>-59a8`.
- **Canonical branch for PC access: `main`.** Fast-forwarded 2026-08-16 with company setup, master+appendices, Union Payroll brand, localhost.run + `deploy-live.sh`, and continuity docs (was tip of `cursor/medialaunch-brand-ui-59a8` / PR **#6**).
- Desktop clone path in this session: `C:\Users\jahwo\Documents\Attest` (empty `Documents\Attext` folder is not the repo).
- Superseded feature branches (safe to ignore / close after merge): PR **#5**, PR **#4**, and historical `cursor/medialaunch-brand-ui-59a8`.
- On a work PC: `git checkout main && git pull origin main`.

## Runtime snapshot (this environment)

- Windows desktop, 2026-08-16: local API on `:8787` (`NODE_ENV=production node src/index.js` in `server/`). UI: http://localhost:8787
- Phone tunnel is a Linux/tmux workflow (`attest-tunnel`); do not assume it is running on this Windows box. Live URL only in `TUNNEL_URL.txt` on the host that runs the tunnel.

## Known issues / next

- [x] Phone tunnel “No tunnel here” → stale `*.lhr.life` after restart; use `TUNNEL_URL.txt`.
- [x] Continuity docs + `/update-project-status` slash entry.
- [x] Separate live deploy from tunnel lifecycle (`deploy-live.sh` / hold tunnel during local downtime).
- [x] Merge outstanding feature work to `main` (FF of PR #6 tip; #4/#5 superseded).
- [x] Delete company with Are-you-sure dialog.
- [x] Per-company intro email + local Gmail signature file.
- [ ] Optional: stable public host (named tunnel / forever-free SSH key) so URL never changes even on SSH death.
- [ ] Default New contract sending company to **Union Payroll**.
- [ ] Say “deploy to live” when phone demo should pick up new code (don’t assume every commit is live).
- [ ] Make `npm start` work on Windows (`cross-env` or equivalent).

## Continuity for humans (any device)

You do **not** need a special “quit” command.

What persists across devices:

1. **This repo on GitHub** — `AGENTS.md` + `docs/PROJECT_STATUS.md`.
2. **Cursor User Rules** — stable preferences only.
3. **Chat history** — not the source of truth across devices.

Before leaving a session: run **`/update-project-status`** (or say “update project status and push”).
