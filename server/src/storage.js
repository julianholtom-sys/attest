import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, sha256 } from "./db.js";

const ROOT = path.join(DATA_DIR, "files");

const DIRS = {
  snapshots: path.join(ROOT, "snapshots"),
  baked: path.join(ROOT, "baked"),
  completed: path.join(ROOT, "completed"),
  certificates: path.join(ROOT, "certificates"),
  evidence: path.join(ROOT, "evidence"),
  signatures: path.join(ROOT, "signatures"),
  assets: path.join(ROOT, "assets"),
  uploads: path.join(ROOT, "uploads"),
};

for (const dir of Object.values(DIRS)) {
  fs.mkdirSync(dir, { recursive: true });
}

export function absolutePath(storageRef) {
  const full = path.resolve(ROOT, storageRef);
  if (!full.startsWith(ROOT)) {
    throw new Error("Invalid storage ref");
  }
  return full;
}

export function writeBytes(kind, fileName, bytes) {
  const dir = DIRS[kind];
  if (!dir) throw new Error(`Unknown storage kind: ${kind}`);
  const safe = fileName.replace(/[^\w.\-]+/g, "_");
  const full = path.join(dir, safe);
  fs.writeFileSync(full, bytes);
  const storageRef = path.relative(ROOT, full);
  return {
    storageRef,
    sha256: sha256(bytes),
    sizeBytes: bytes.length,
  };
}

export function writeBase64Png(kind, fileName, dataUrl) {
  const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, "");
  const bytes = Buffer.from(base64, "base64");
  return writeBytes(kind, fileName, bytes);
}

export function readBytes(storageRef) {
  return fs.readFileSync(absolutePath(storageRef));
}

export function exists(storageRef) {
  return fs.existsSync(absolutePath(storageRef));
}
