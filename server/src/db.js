import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, "../data");
export const DB_PATH = path.join(DATA_DIR, "attest.sqlite");

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function newId() {
  return randomBytes(16).toString("hex").replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5"
  );
}

export function now() {
  return new Date().toISOString();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  legal_name TEXT NOT NULL,
  company_number TEXT NOT NULL,
  vat_number TEXT,
  registered_office TEXT NOT NULL,
  display_name TEXT NOT NULL,
  brand_json TEXT NOT NULL,
  sending_domain TEXT NOT NULL,
  from_address TEXT NOT NULL,
  reply_to TEXT,
  email_signature_html TEXT NOT NULL,
  email_signature_text TEXT NOT NULL,
  domain_verified INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_entity_access (
  user_id TEXT NOT NULL REFERENCES users(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  PRIMARY KEY (user_id, entity_id)
);

CREATE TABLE IF NOT EXISTS entity_assets (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  kind TEXT NOT NULL CHECK (kind IN ('front_cover','back_cover','logo','email_header')),
  name TEXT,
  storage_ref TEXT NOT NULL,
  mime TEXT,
  page_size TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  template_type TEXT NOT NULL CHECK (template_type IN (
    'invitation','resend','reminder','turn_notification',
    'declined_notice','voided_notice','completion'
  )),
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL,
  UNIQUE (entity_id, template_type)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES entities(id),
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  default_front_cover TEXT REFERENCES entity_assets(id),
  default_back_cover TEXT REFERENCES entity_assets(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  version_no INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (template_id, content_hash)
);

CREATE TABLE IF NOT EXISTS template_roles (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  role_key TEXT NOT NULL CHECK (role_key IN ('company','agency','supplier')),
  label TEXT,
  signing_order INTEGER NOT NULL,
  evidence_required INTEGER NOT NULL DEFAULT 0,
  UNIQUE (template_id, role_key)
);

CREATE TABLE IF NOT EXISTS evidence_requirements (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES template_roles(id),
  requirement_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  accepted_mimes TEXT NOT NULL,
  max_size_bytes INTEGER,
  verify_method TEXT NOT NULL CHECK (verify_method IN (
    'upload','companies_house_api','hmrc_vat_api'
  )),
  is_required INTEGER NOT NULL DEFAULT 1,
  UNIQUE (role_id, requirement_key)
);

CREATE TABLE IF NOT EXISTS template_fields (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  role_id TEXT NOT NULL REFERENCES template_roles(id),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'text','date','checkbox','signature','initials','attachment'
  )),
  required INTEGER NOT NULL DEFAULT 1,
  page INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  validation_json TEXT
);

CREATE TABLE IF NOT EXISTS envelopes (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  template_version_id TEXT REFERENCES template_versions(id),
  front_cover_id TEXT REFERENCES entity_assets(id),
  back_cover_id TEXT REFERENCES entity_assets(id),
  baked_document_id TEXT,
  baked_hash TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'draft','baking','ready','in_progress',
    'completed','declined','voided','expired'
  )),
  signing_mode TEXT NOT NULL DEFAULT 'sequential',
  reminder_frequency TEXT NOT NULL DEFAULT 'none' CHECK (reminder_frequency IN (
    'none','daily','every_3_days','weekly'
  )),
  max_auto_reminders INTEGER NOT NULL DEFAULT 5,
  external_client_ref TEXT,
  title TEXT,
  bake_error TEXT,
  expires_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  void_reason TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL REFERENCES envelopes(id),
  kind TEXT NOT NULL CHECK (kind IN ('snapshot','baked','completed','certificate')),
  storage_ref TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS envelope_parties (
  id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL REFERENCES envelopes(id),
  role_id TEXT NOT NULL REFERENCES template_roles(id),
  company_name TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending','notified','viewed','in_progress','completed','declined'
  )),
  order_index INTEGER NOT NULL,
  declined_reason TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS party_access_tokens (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES envelope_parties(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_values (
  id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL REFERENCES envelopes(id),
  field_id TEXT NOT NULL REFERENCES template_fields(id),
  party_id TEXT NOT NULL REFERENCES envelope_parties(id),
  value TEXT,
  value_hash TEXT,
  captured_at TEXT,
  captured_ip TEXT,
  UNIQUE (envelope_id, field_id)
);

CREATE TABLE IF NOT EXISTS signatures (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES envelope_parties(id),
  envelope_id TEXT NOT NULL REFERENCES envelopes(id),
  method TEXT NOT NULL CHECK (method IN ('drawn','typed','uploaded')),
  signature_asset_ref TEXT,
  document_hash TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consent_given_at TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_files (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES envelope_parties(id),
  envelope_id TEXT NOT NULL REFERENCES envelopes(id),
  requirement_id TEXT NOT NULL REFERENCES evidence_requirements(id),
  review_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (review_status IN (
    'uploaded','accepted','rejected'
  )),
  rejected_reason TEXT,
  original_name TEXT,
  mime TEXT,
  size_bytes INTEGER,
  storage_ref TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_ip TEXT,
  retention_expires_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS verification_results (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES envelope_parties(id),
  requirement_id TEXT NOT NULL REFERENCES evidence_requirements(id),
  provider TEXT,
  query_value TEXT,
  result TEXT NOT NULL CHECK (result IN ('verified','not_found','mismatch')),
  response_snapshot TEXT,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id TEXT REFERENCES envelopes(id),
  party_id TEXT REFERENCES envelope_parties(id),
  actor TEXT,
  event_type TEXT NOT NULL,
  metadata_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES entities(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
  envelope_id TEXT NOT NULL REFERENCES envelopes(id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  delivered_at TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_emails (
  id TEXT PRIMARY KEY,
  envelope_id TEXT,
  party_id TEXT,
  template_type TEXT,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

db.exec(SCHEMA);

export function rowToObject(row) {
  if (!row) return null;
  return { ...row };
}

export function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
