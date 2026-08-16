import { db } from "./db.js";

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function ensureColumn(table, column, sqlType) {
  const cols = tableColumns(table);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
  }
}

export function migrate() {
  ensureColumn("templates", "industry", "TEXT");
  ensureColumn("templates", "description", "TEXT");
  ensureColumn("envelopes", "prepared_on", "TEXT");
  ensureColumn("envelopes", "issued_at", "TEXT");
  ensureColumn("envelopes", "industry", "TEXT");
  ensureColumn("envelopes", "template_id", "TEXT");
  ensureColumn("envelopes", "logo_asset_id", "TEXT");
  ensureColumn("envelopes", "appendix_ids_json", "TEXT");
  ensureColumn("envelopes", "contract_page_offset", "INTEGER DEFAULT 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS appendices (
      id TEXT PRIMARY KEY,
      entity_id TEXT REFERENCES entities(id),
      industry TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      storage_ref TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
}
