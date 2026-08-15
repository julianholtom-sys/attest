import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, "../data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const SIGNED_DIR = path.join(DATA_DIR, "signed");
const DB_PATH = path.join(DATA_DIR, "db.json");

function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOADS_DIR, SIGNED_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ envelopes: [] }, null, 2));
  }
}

function readDb() {
  ensureDirs();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  ensureDirs();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function listEnvelopes() {
  return readDb().envelopes.sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
}

export function getEnvelope(id) {
  return readDb().envelopes.find((e) => e.id === id) || null;
}

export function createEnvelope({ title, fileName, storedName, signers }) {
  const now = new Date().toISOString();
  const envelope = {
    id: nanoid(10),
    title: title || fileName || "Untitled document",
    status: "draft",
    fileName,
    storedName,
    signers: (signers || []).map((s, i) => ({
      id: nanoid(8),
      name: s.name || `Signer ${i + 1}`,
      email: s.email || "",
      role: s.role || "signer",
      status: "pending",
      signedAt: null,
      signatureDataUrl: null,
    })),
    fields: [],
    audit: [
      {
        id: nanoid(8),
        at: now,
        action: "created",
        detail: "Envelope created (local)",
      },
    ],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    signedStoredName: null,
  };
  const db = readDb();
  db.envelopes.push(envelope);
  writeDb(db);
  return envelope;
}

export function updateEnvelope(id, patch) {
  const db = readDb();
  const idx = db.envelopes.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const prev = db.envelopes[idx];
  const next = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  db.envelopes[idx] = next;
  writeDb(db);
  return next;
}

export function addAudit(id, action, detail) {
  const env = getEnvelope(id);
  if (!env) return null;
  const entry = {
    id: nanoid(8),
    at: new Date().toISOString(),
    action,
    detail,
  };
  return updateEnvelope(id, { audit: [...env.audit, entry] });
}

export function deleteEnvelope(id) {
  const db = readDb();
  const env = db.envelopes.find((e) => e.id === id);
  if (!env) return false;
  db.envelopes = db.envelopes.filter((e) => e.id !== id);
  writeDb(db);
  for (const name of [env.storedName, env.signedStoredName]) {
    if (!name) continue;
    const dir = name === env.signedStoredName ? SIGNED_DIR : UPLOADS_DIR;
    const p = path.join(dir, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return true;
}

ensureDirs();
