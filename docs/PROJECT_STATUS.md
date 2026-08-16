# Attest — project status

Last updated: 2026-08-16 (UTC)

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

## How to run

```bash
npm install
npm run build
npm start          # http://localhost:8787
```

Dev split: `npm run dev` (API 8787, Vite 5173).

### Phone / public demo

```bash
# API must be up on 8787 first
bash scripts/keep-tunnel-alive.sh
# Live URL → TUNNEL_URL.txt
```

Do **not** rely on Cloudflare quick tunnels for demos; they were returning 530 while still appearing connected.

## Recent work stream (high level)

1. Local Attest stack from e-sign data model (SQLite + disk).
2. Auto covers / logo / industry appendices at bake.
3. Company setup catalog + sending-company dropdown on create.
4. Restructure to master contract + selectable industry appendices; upload/update UI.
5. Restyle to Union Payroll brand (after correcting mistaken Media Launch pass).
6. Phone tunnel: Cloudflare → localhost.run watchdog with public health checks.

## Active git / PR notes

- Feature branch naming: `cursor/<name>-59a8`.
- Recent brand + tunnel work has been on `cursor/medialaunch-brand-ui-59a8` (name is historical; content is Union Payroll + localhost.run).
- Related earlier PRs also covered company dropdown and master/appendices flows — check GitHub for merge state before branching from `main`.

## Known issues / next

- [ ] Phone tunnel: user reported “No tunnel here” on localhost.run — investigate/restart watchdog; confirm `TUNNEL_URL.txt` matches a URL that returns 200 for `/api/health`.
- [ ] Merge outstanding feature PRs to `main` if not already merged.
- [ ] Optional: named/stable public host (Cloudflare named tunnel or localhost.run forever-free with SSH key) if ephemeral `*.lhr.life` URLs remain too brittle.
- [ ] Prefer Union Payroll as default selected sending company on New contract.

## Continuity for humans (any device)

You do **not** need a special “quit” command.

What actually persists across devices:

1. **This repo on GitHub** — `AGENTS.md` + `docs/PROJECT_STATUS.md` (ask the agent to update + push at the end of a session).
2. **Cursor User Rules** (account settings) — stable preferences; not a substitute for project status.
3. **Chat history** — local to that conversation/device path; do not treat as the source of truth.

Practical habit: before leaving a session, say “update project status and push.” Opening the same repo elsewhere is then enough for the next agent to catch up.
