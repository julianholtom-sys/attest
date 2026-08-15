import { db, now, sha256 } from "./db.js";

const GENESIS = "0".repeat(64);

function canonicalEvent({
  envelope_id,
  party_id,
  actor,
  event_type,
  metadata_json,
  ip,
  user_agent,
  created_at,
  prev_hash,
}) {
  return [
    envelope_id || "",
    party_id || "",
    actor || "",
    event_type,
    metadata_json || "{}",
    ip || "",
    user_agent || "",
    created_at,
    prev_hash,
  ].join("|");
}

export function appendEvent({
  envelopeId = null,
  partyId = null,
  actor = "system",
  eventType,
  metadata = {},
  ip = null,
  userAgent = null,
}) {
  const createdAt = now();
  const last = db
    .prepare("SELECT row_hash FROM events ORDER BY id DESC LIMIT 1")
    .get();
  const prevHash = last?.row_hash || GENESIS;
  const metadataJson = JSON.stringify(metadata || {});
  const rowHash = sha256(
    canonicalEvent({
      envelope_id: envelopeId,
      party_id: partyId,
      actor,
      event_type: eventType,
      metadata_json: metadataJson,
      ip,
      user_agent: userAgent,
      created_at: createdAt,
      prev_hash: prevHash,
    })
  );

  const info = db
    .prepare(
      `INSERT INTO events (
        envelope_id, party_id, actor, event_type, metadata_json,
        ip, user_agent, created_at, prev_hash, row_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      envelopeId,
      partyId,
      actor,
      eventType,
      metadataJson,
      ip,
      userAgent,
      createdAt,
      prevHash,
      rowHash
    );

  return {
    id: Number(info.lastInsertRowid),
    envelope_id: envelopeId,
    party_id: partyId,
    actor,
    event_type: eventType,
    metadata,
    created_at: createdAt,
    prev_hash: prevHash,
    row_hash: rowHash,
  };
}

export function listEvents(envelopeId = null) {
  const rows = envelopeId
    ? db
        .prepare(
          "SELECT * FROM events WHERE envelope_id = ? ORDER BY id ASC"
        )
        .all(envelopeId)
    : db.prepare("SELECT * FROM events ORDER BY id ASC").all();
  return rows.map((r) => ({
    ...r,
    metadata: JSON.parse(r.metadata_json || "{}"),
  }));
}

export function verifyEventChain(envelopeId = null) {
  const all = db.prepare("SELECT * FROM events ORDER BY id ASC").all().map((r) => ({
    ...r,
    metadata: JSON.parse(r.metadata_json || "{}"),
  }));
  const broken = [];
  let prev = GENESIS;
  for (const row of all) {
    if (row.prev_hash !== prev) {
      broken.push({ id: row.id, reason: "prev_hash_mismatch", scope: "global" });
    }
    const expected = sha256(
      canonicalEvent({
        envelope_id: row.envelope_id,
        party_id: row.party_id,
        actor: row.actor,
        event_type: row.event_type,
        metadata_json: JSON.stringify(row.metadata || {}),
        ip: row.ip,
        user_agent: row.user_agent,
        created_at: row.created_at,
        prev_hash: row.prev_hash,
      })
    );
    if (expected !== row.row_hash) {
      broken.push({ id: row.id, reason: "row_hash_mismatch", scope: "global" });
    }
    prev = row.row_hash;
  }

  const scoped = envelopeId
    ? all.filter((r) => r.envelope_id === envelopeId)
    : all;
  const scopedBroken = envelopeId
    ? scoped
        .map((row) => {
          const expected = sha256(
            canonicalEvent({
              envelope_id: row.envelope_id,
              party_id: row.party_id,
              actor: row.actor,
              event_type: row.event_type,
              metadata_json: JSON.stringify(row.metadata || {}),
              ip: row.ip,
              user_agent: row.user_agent,
              created_at: row.created_at,
              prev_hash: row.prev_hash,
            })
          );
          return expected === row.row_hash
            ? null
            : { id: row.id, reason: "row_hash_mismatch", scope: "envelope" };
        })
        .filter(Boolean)
    : broken;

  return {
    ok: (envelopeId ? scopedBroken : broken).length === 0 && broken.length === 0,
    checked: scoped.length,
    global_checked: all.length,
    broken: envelopeId ? [...broken.filter((b) => scoped.some((s) => s.id === b.id)), ...scopedBroken] : broken,
  };
}
