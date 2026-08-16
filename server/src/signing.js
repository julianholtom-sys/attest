import { createHash, randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, newId, now, sha256 } from "./db.js";
import { appendEvent } from "./events.js";
import { sendTemplatedEmail } from "./mail.js";
import { readBytes, writeBytes, writeBase64Png } from "./storage.js";

const CONSENT_TEXT =
  "I agree to sign this document electronically. I understand that my electronic signature is as legally binding as a handwritten signature.";

export function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

export function issuePartyToken(partyId, { days = 14 } = {}) {
  const raw = randomBytes(32).toString("hex");
  const id = newId();
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  // revoke prior tokens
  db.prepare(
    "UPDATE party_access_tokens SET revoked_at = ? WHERE party_id = ? AND revoked_at IS NULL AND used_at IS NULL"
  ).run(now(), partyId);
  db.prepare(
    `INSERT INTO party_access_tokens (id, party_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, partyId, hashToken(raw), expires, now());
  return { raw, id, expiresAt: expires };
}

export function resolveToken(raw) {
  const tokenHash = hashToken(raw);
  const token = db
    .prepare(
      `SELECT t.*, p.envelope_id, p.status AS party_status, p.signer_name, p.signer_email,
              p.company_name, p.role_id, p.order_index
       FROM party_access_tokens t
       JOIN envelope_parties p ON p.id = t.party_id
       WHERE t.token_hash = ?`
    )
    .get(tokenHash);
  if (!token) return null;
  if (token.revoked_at) return null;
  if (token.used_at) return null;
  if (new Date(token.expires_at).getTime() < Date.now()) return null;
  return token;
}

export function getActionableParty(envelopeId) {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ?").get(envelopeId);
  if (!envelope || !["ready", "in_progress"].includes(envelope.status)) return null;
  return db
    .prepare(
      `SELECT * FROM envelope_parties
       WHERE envelope_id = ? AND status NOT IN ('completed','declined')
       ORDER BY order_index ASC LIMIT 1`
    )
    .get(envelopeId);
}

export function evidenceChecklist(partyId) {
  const party = db.prepare("SELECT * FROM envelope_parties WHERE id = ?").get(partyId);
  const role = db.prepare("SELECT * FROM template_roles WHERE id = ?").get(party.role_id);
  const requirements = db
    .prepare("SELECT * FROM evidence_requirements WHERE role_id = ?")
    .all(party.role_id);
  return requirements.map((req) => {
    const file = db
      .prepare(
        `SELECT * FROM evidence_files
         WHERE party_id = ? AND requirement_id = ? AND deleted_at IS NULL
         ORDER BY uploaded_at DESC LIMIT 1`
      )
      .get(partyId, req.id);
    const verification = db
      .prepare(
        `SELECT * FROM verification_results
         WHERE party_id = ? AND requirement_id = ?
         ORDER BY checked_at DESC LIMIT 1`
      )
      .get(partyId, req.id);
    const satisfied =
      (file && ["uploaded", "accepted"].includes(file.review_status)) ||
      verification?.result === "verified";
    return {
      ...req,
      accepted_mimes: JSON.parse(req.accepted_mimes || "[]"),
      file: file || null,
      verification: verification || null,
      satisfied: Boolean(satisfied),
      evidence_required: Boolean(role.evidence_required),
    };
  });
}

export function evidenceGateOpen(partyId) {
  const party = db.prepare("SELECT * FROM envelope_parties WHERE id = ?").get(partyId);
  const role = db.prepare("SELECT * FROM template_roles WHERE id = ?").get(party.role_id);
  if (!role.evidence_required) return { ok: true, checklist: [] };
  const checklist = evidenceChecklist(partyId);
  const missing = checklist.filter((c) => c.is_required && !c.satisfied);
  return { ok: missing.length === 0, checklist, missing };
}

export function inviteParty(envelopeId, partyId, { baseUrl, actor = "system" } = {}) {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ?").get(envelopeId);
  const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(envelope.entity_id);
  const party = db.prepare("SELECT * FROM envelope_parties WHERE id = ?").get(partyId);
  const role = db.prepare("SELECT * FROM template_roles WHERE id = ?").get(party.role_id);
  const token = issuePartyToken(partyId);
  const signingLink = `${baseUrl}/sign/${token.raw}`;

  sendTemplatedEmail({
    entityId: entity.id,
    templateType: envelope.status === "ready" && party.status === "pending"
      ? "invitation"
      : "turn_notification",
    to: party.signer_email,
    envelopeId,
    partyId,
    actor,
    vars: {
      signer_name: party.signer_name,
      signer_company: party.company_name,
      entity_display_name: entity.display_name,
      envelope_title: envelope.title || "Document",
      signing_link: signingLink,
      expiry_date: envelope.expires_at || "",
      role_label: role.label || role.role_key,
      declined_by: "",
      decline_reason: "",
    },
  });

  db.prepare(
    "UPDATE envelope_parties SET status = CASE WHEN status = 'pending' THEN 'notified' ELSE status END WHERE id = ?"
  ).run(partyId);

  return { signingLink, tokenId: token.id };
}

export function startSigningInvites(envelopeId, baseUrl, actor = "staff") {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ?").get(envelopeId);
  if (!envelope || envelope.status !== "ready") {
    throw new Error("Envelope must be ready before inviting");
  }
  if (!envelope.baked_hash) throw new Error("Envelope is not baked");

  const issuedAt = now();
  db.prepare(
    "UPDATE envelopes SET issued_at = COALESCE(issued_at, ?) WHERE id = ?"
  ).run(issuedAt, envelopeId);

  const first = getActionableParty(envelopeId);
  if (!first) throw new Error("No actionable party");
  const result = inviteParty(envelopeId, first.id, { baseUrl, actor });
  return { ...result, issuedAt };
}

export async function applySignatureAndCompleteParty({
  envelopeId,
  partyId,
  method,
  signatureDataUrl,
  typedName,
  ip,
  userAgent,
  tokenRow,
}) {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ?").get(envelopeId);
  if (!["ready", "in_progress"].includes(envelope.status)) {
    throw new Error("Envelope is not open for signing");
  }
  if (!envelope.baked_hash) throw new Error("Missing baked hash");

  const actionable = getActionableParty(envelopeId);
  if (!actionable || actionable.id !== partyId) {
    throw new Error("It is not this party's turn");
  }

  const gate = evidenceGateOpen(partyId);
  if (!gate.ok) {
    throw new Error(
      `Evidence gate locked: missing ${gate.missing.map((m) => m.requirement_key).join(", ")}`
    );
  }

  // role-owned fields must be complete when required
  const fields = db
    .prepare("SELECT * FROM template_fields WHERE role_id = ?")
    .all(actionable.role_id);
  for (const field of fields) {
    if (!field.required) continue;
    if (field.field_type === "signature" || field.field_type === "initials") continue;
    const value = db
      .prepare(
        "SELECT * FROM field_values WHERE envelope_id = ? AND field_id = ?"
      )
      .get(envelopeId, field.id);
    if (!value?.value) {
      throw new Error(`Required field missing: ${field.field_key}`);
    }
  }

  const sigFile = writeBase64Png(
    "signatures",
    `${partyId}-${Date.now()}.png`,
    signatureDataUrl
  );

  const consentAt = now();
  const signedAt = consentAt;
  const sigId = newId();
  db.prepare(
    `INSERT INTO signatures (
      id, party_id, envelope_id, method, signature_asset_ref, document_hash,
      consent_text, consent_given_at, signed_at, ip, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sigId,
    partyId,
    envelopeId,
    method,
    sigFile.storageRef,
    envelope.baked_hash,
    CONSENT_TEXT,
    consentAt,
    signedAt,
    ip || "127.0.0.1",
    userAgent || "unknown"
  );

  // store signature field values
  for (const field of fields.filter((f) =>
    ["signature", "initials"].includes(f.field_type)
  )) {
    const value = method === "typed" ? typedName || actionable.signer_name : sigFile.storageRef;
    const valueHash = sha256(String(value));
    const existing = db
      .prepare(
        "SELECT id FROM field_values WHERE envelope_id = ? AND field_id = ?"
      )
      .get(envelopeId, field.id);
    if (existing) {
      db.prepare(
        `UPDATE field_values SET value = ?, value_hash = ?, captured_at = ?, captured_ip = ?, party_id = ?
         WHERE id = ?`
      ).run(value, valueHash, signedAt, ip || "127.0.0.1", partyId, existing.id);
    } else {
      db.prepare(
        `INSERT INTO field_values (
          id, envelope_id, field_id, party_id, value, value_hash, captured_at, captured_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId(),
        envelopeId,
        field.id,
        partyId,
        value,
        valueHash,
        signedAt,
        ip || "127.0.0.1"
      );
    }
  }

  db.prepare(
    "UPDATE envelope_parties SET status = 'completed', completed_at = ? WHERE id = ?"
  ).run(signedAt, partyId);

  // burn token
  if (tokenRow?.id) {
    db.prepare(
      "UPDATE party_access_tokens SET used_at = ? WHERE id = ?"
    ).run(signedAt, tokenRow.id);
  }

  appendEvent({
    envelopeId,
    partyId,
    actor: `party`,
    eventType: "consent_given",
    metadata: { consent_text: CONSENT_TEXT },
    ip,
    userAgent,
  });
  appendEvent({
    envelopeId,
    partyId,
    actor: "party",
    eventType: "signed",
    metadata: {
      signature_id: sigId,
      document_hash: envelope.baked_hash,
      method,
    },
    ip,
    userAgent,
  });

  if (envelope.status === "ready") {
    db.prepare("UPDATE envelopes SET status = 'in_progress' WHERE id = ?").run(
      envelopeId
    );
  }

  const next = getActionableParty(envelopeId);
  if (next) {
    // caller supplies baseUrl via process env default
    return { nextPartyId: next.id, completed: false, signatureId: sigId };
  }

  await finalizeEnvelope(envelopeId);
  return { nextPartyId: null, completed: true, signatureId: sigId };
}

export async function finalizeEnvelope(envelopeId) {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ?").get(envelopeId);
  const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(envelope.entity_id);
  const baked = db
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(envelope.baked_document_id);
  const bakedBytes = readBytes(baked.storage_ref);
  const pdf = await PDFDocument.load(bakedBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const pageOffset = Number(envelope.contract_page_offset || 0);

  const signatures = db
    .prepare("SELECT * FROM signatures WHERE envelope_id = ?")
    .all(envelopeId);

  for (const sig of signatures) {
    const party = db.prepare("SELECT * FROM envelope_parties WHERE id = ?").get(sig.party_id);
    const fields = db
      .prepare(
        `SELECT * FROM template_fields
         WHERE role_id = ? AND field_type IN ('signature','initials')`
      )
      .all(party.role_id);
    const pngBytes = readBytes(sig.signature_asset_ref);
    const image = await pdf.embedPng(pngBytes);
    for (const field of fields) {
      const page = pages[Math.min(pageOffset + (field.page || 0), pages.length - 1)];
      page.drawImage(image, {
        x: Number(field.x),
        y: Number(field.y),
        width: Number(field.w),
        height: Number(field.h),
      });
    }
  }

  // text field values
  const values = db
    .prepare(
      `SELECT fv.*, tf.field_type, tf.page, tf.x, tf.y, tf.w, tf.h
       FROM field_values fv
       JOIN template_fields tf ON tf.id = fv.field_id
       WHERE fv.envelope_id = ?`
    )
    .all(envelopeId);
  for (const v of values) {
    if (["signature", "initials", "attachment"].includes(v.field_type)) continue;
    const page = pages[Math.min(pageOffset + (v.page || 0), pages.length - 1)];
    page.drawText(String(v.value || ""), {
      x: Number(v.x) + 2,
      y: Number(v.y) + 4,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  const completedBytes = Buffer.from(await pdf.save());
  const completedFile = writeBytes(
    "completed",
    `${envelopeId}-completed.pdf`,
    completedBytes
  );
  const completedDocId = newId();
  db.prepare(
    `INSERT INTO documents (id, envelope_id, kind, storage_ref, sha256, size_bytes, created_at)
     VALUES (?, ?, 'completed', ?, ?, ?, ?)`
  ).run(
    completedDocId,
    envelopeId,
    completedFile.storageRef,
    completedFile.sha256,
    completedFile.sizeBytes,
    now()
  );

  // certificate page
  const cert = await PDFDocument.create();
  const certPage = cert.addPage([595.28, 841.89]);
  certPage.drawText("Attest completion certificate", {
    x: 50,
    y: 780,
    size: 18,
    font: await cert.embedFont(StandardFonts.HelveticaBold),
  });
  const bodyFont = await cert.embedFont(StandardFonts.Helvetica);
  const lines = [
    `Envelope: ${envelope.id}`,
    `Title: ${envelope.title || ""}`,
    `Entity: ${entity.legal_name}`,
    `Baked hash: ${envelope.baked_hash}`,
    `Completed hash: ${completedFile.sha256}`,
    "",
    "Signers:",
    ...signatures.map((s) => {
      const p = db.prepare("SELECT * FROM envelope_parties WHERE id = ?").get(s.party_id);
      return `- ${p.signer_name} <${p.signer_email}> @ ${s.signed_at} ip=${s.ip}`;
    }),
  ];
  let y = 740;
  for (const line of lines) {
    certPage.drawText(line.slice(0, 95), { x: 50, y, size: 10, font: bodyFont });
    y -= 16;
  }
  const certBytes = Buffer.from(await cert.save());
  const certFile = writeBytes("certificates", `${envelopeId}-certificate.pdf`, certBytes);
  const certDocId = newId();
  db.prepare(
    `INSERT INTO documents (id, envelope_id, kind, storage_ref, sha256, size_bytes, created_at)
     VALUES (?, ?, 'certificate', ?, ?, ?, ?)`
  ).run(
    certDocId,
    envelopeId,
    certFile.storageRef,
    certFile.sha256,
    certFile.sizeBytes,
    now()
  );

  const completedAt = now();
  db.prepare(
    "UPDATE envelopes SET status = 'completed', completed_at = ? WHERE id = ?"
  ).run(completedAt, envelopeId);

  appendEvent({
    envelopeId,
    actor: "system",
    eventType: "completed",
    metadata: {
      completed_document_id: completedDocId,
      certificate_document_id: certDocId,
      baked_hash: envelope.baked_hash,
    },
  });
  appendEvent({
    envelopeId,
    actor: "system",
    eventType: "copies_distributed",
    metadata: { local_only: true, parties: signatures.length },
  });

  // completion emails (local log)
  const parties = db
    .prepare("SELECT * FROM envelope_parties WHERE envelope_id = ?")
    .all(envelopeId);
  for (const party of parties) {
    sendTemplatedEmail({
      entityId: entity.id,
      templateType: "completion",
      to: party.signer_email,
      envelopeId,
      partyId: party.id,
      vars: {
        signer_name: party.signer_name,
        signer_company: party.company_name,
        entity_display_name: entity.display_name,
        envelope_title: envelope.title || "Document",
        signing_link: "",
        expiry_date: "",
        role_label: "",
        declined_by: "",
        decline_reason: "",
      },
    });
  }

  return db.prepare("SELECT * FROM envelopes WHERE id = ?").get(envelopeId);
}

export { CONSENT_TEXT };
