# Attest — project status

Last updated: 2026-08-16 ~09:30 UTC

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

### Templates

- **One master contract** — always included on every contract.
- **Industry appendices** — optional; chosen per contract (not auto-all for an industry).
- Templates UI supports upload/update for master PDF and add/update/replace for appendices.

### Contracts (envelopes)

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

Dev split: `npm run dev` (API 8787, Vite 5173).

### Phone / public demo

```bash
# One-time / recovery (starts API + tunnel)
bash scripts/start-live.sh
cat TUNNEL_URL.txt

# Publish code changes WITHOUT changing the public URL
bash scripts/deploy-live.sh
```

- Prefer **localhost.run** `*.lhr.life` via the watchdog script.
- Do **not** rely on Cloudflare `*.trycloudflare.com` quick tunnels.
- “No tunnel here” = **stale hostname** after SSH restarted — avoid restarting the tunnel during normal work.
- Agents must not kill the tunnel when editing/building; only `deploy-live.sh` updates what the existing URL serves.

## Continuity tooling

- `AGENTS.md` — short agent briefing (read at session start).
- `docs/PROJECT_STATUS.md` — this log.
- `.cursor/rules/attest-continuity.mdc` — always-apply reminder.
- **`/update-project-status`** — Agent slash command + skill (`.cursor/commands/` + `.cursor/skills/update-project-status/`) to refresh these docs and push.

## Recent work stream (high level)

1. Local Attest stack from e-sign data model (SQLite + disk).
2. Auto covers / logo / industry appendices at bake.
3. Company setup catalog + sending-company dropdown on create.
4. Restructure to master contract + selectable industry appendices; upload/update UI.
5. Restyle to Union Payroll brand (after correcting mistaken Media Launch pass).
6. Phone tunnel: Cloudflare → localhost.run watchdog with public health checks.
7. Cross-device continuity docs + Cursor rule.
8. Persistent `/update-project-status` slash command/skill.
9. **Live demo persistence:** `deploy-live.sh` publishes code without recycling the tunnel URL; watchdog ignores local downtime during deploys.

## Active git / PR notes

- Feature branch naming: `cursor/<name>-59a8`.
- **Current tip of brand/tunnel/continuity work:** `cursor/medialaunch-brand-ui-59a8` (branch name is historical; content is Union Payroll + localhost.run + continuity). Open PR **#6**.
- Still open (may overlap / need rebase or close after #6 lands):
  - PR **#5** `cursor/master-contract-appendices-59a8` — master + appendices
  - PR **#4** `cursor/company-setup-dropdown-59a8` — company setup dropdown
- Check merge state on GitHub before branching from `main`; prefer consolidating into `main` rather than leaving parallel stacks.

## Known issues / next

- [x] Phone tunnel “No tunnel here” → stale `*.lhr.life` after restart; use `TUNNEL_URL.txt`.
- [x] Continuity docs + `/update-project-status` slash entry.
- [x] Separate live deploy from tunnel lifecycle (`deploy-live.sh` / hold tunnel during local downtime).
- [ ] Merge outstanding feature PRs to `main` (likely #4/#5/#6 or squash equivalent).
- [ ] Optional: stable public host (named tunnel / forever-free SSH key) so URL never changes even on SSH death.
- [ ] Default New contract sending company to **Union Payroll**.

## Continuity for humans (any device)

You do **not** need a special “quit” command.

What actually persists across devices:

1. **This repo on GitHub** — `AGENTS.md` + `docs/PROJECT_STATUS.md`.
2. **Cursor User Rules** — stable preferences only.
3. **Chat history** — not the source of truth across devices.

Before leaving a session: run **`/update-project-status`** (or say “update project status and push”).
