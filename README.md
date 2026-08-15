# Attest

Local implementation of the **E-Signature Platform data model** (three-party company / agency / supplier signing) using **Vite + React + Express + SQLite + local disk**. No Google Identity, no GCS, no Cloud SQL.

Specification: [`docs/esign-data-model.pdf`](docs/esign-data-model.pdf)

## What is implemented

- Entities with brand tokens, verified sending domain gate, email signature blocks
- Seeded email templates (invitation / resend / reminder / turn / decline / void / completion) with merge-variable validation
- Templates with `company` / `agency` / `supplier` roles, field ownership, and company evidence requirements
- Envelope lifecycle: `draft → baking → ready → in_progress → completed` (+ void/decline)
- Bake pipeline: snapshot hash → template version → assembled baked PDF + `baked_hash`
- Sequential signing with hashed access tokens (raw token only in link)
- Evidence gate for company role before signature
- Signatures store consent text verbatim + `document_hash` must equal `baked_hash`
- Append-only `events` table with hash chain verification
- Local “email outbox” (`outbound_emails`) instead of a transactional ESP
- Completion PDF + certificate artifacts on disk under `server/data/files`

## Run

```bash
npm install
npm run dev
```

- UI: http://localhost:5173
- API: http://localhost:8787

Production:

```bash
npm run build
npm start
```

## Demo path

1. Open **Templates** / **Entities** to inspect the seeded Acme profile + MSA template
2. **New envelope** → fill company/agency/supplier parties → create draft
3. **Bake** → **Send first invitation**
4. Use **Mint / resend link** per party (or the link returned by send) to open `/sign/:token`
5. Company party must upload the four evidence files before signing
6. After all three parties sign, open completed PDF + certificate

## Local substitutions vs the brief

| Brief | Local Attest |
| --- | --- |
| Cloud SQL (Postgres) | SQLite (`server/data/attest.sqlite`) |
| GCS | `server/data/files/**` |
| Google Identity | Seeded local staff user (no Google auth) |
| Transactional email + DNS domains | Verified flag + local outbox log |
| Companies House / HMRC APIs | Upload-only evidence path in seed |

## Notes

Immutable bake, role-scoped fields, evidence checklist, and hash-chained audit events are enforced in the API. Webhook delivery workers and full admin editors for assets/email templates are stubbed by seed data for this local framework pass.
