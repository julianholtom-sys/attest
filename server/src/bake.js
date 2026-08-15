import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, newId, now, sha256 } from "./db.js";
import { appendEvent } from "./events.js";
import { readBytes, writeBytes } from "./storage.js";

async function loadOrCreateSourcePdf(template) {
  // Local mode: source_url may be a local storage_ref ("uploads/...") or absolute path key.
  // For seed templates we store a snapshot file and point source_url at local://uploads/...
  let bytes;
  if (template.source_url.startsWith("local://")) {
    bytes = readBytes(template.source_url.replace("local://", ""));
  } else {
    // Minimal stub PDF if remote fetch is unavailable in local mode
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]); // A4
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(template.name, { x: 50, y: 780, size: 18, font });
    page.drawText("Local snapshot (source URL not fetched in local mode).", {
      x: 50,
      y: 750,
      size: 11,
      font,
    });
    bytes = Buffer.from(await doc.save());
  }
  return bytes;
}

export async function bakeEnvelope(envelopeId, { actor = "system" } = {}) {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ?").get(envelopeId);
  if (!envelope) throw new Error("Envelope not found");
  if (!["draft", "baking"].includes(envelope.status)) {
    throw new Error("Only draft envelopes can be baked");
  }

  db.prepare(
    "UPDATE envelopes SET status = 'baking', bake_error = NULL WHERE id = ?"
  ).run(envelopeId);

  try {
    const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(envelope.entity_id);
    if (!entity?.domain_verified) {
      throw new Error("Entity domain is not verified");
    }

    const parties = db
      .prepare(
        `SELECT p.*, r.role_key, r.signing_order
         FROM envelope_parties p
         JOIN template_roles r ON r.id = p.role_id
         WHERE p.envelope_id = ?
         ORDER BY p.order_index ASC`
      )
      .all(envelopeId);
    if (parties.length !== 3) {
      throw new Error("All three parties (company/agency/supplier) must be assigned");
    }

    // Resolve template: envelopes in draft may only have a linked template via parties' roles
    const role = db
      .prepare("SELECT * FROM template_roles WHERE id = ?")
      .get(parties[0].role_id);
    const template = db
      .prepare("SELECT * FROM templates WHERE id = ?")
      .get(role.template_id);
    if (!template) throw new Error("Template missing");

    const fields = db
      .prepare("SELECT * FROM template_fields WHERE template_id = ?")
      .all(template.id);
    if (fields.some((f) => f.x == null || f.y == null)) {
      throw new Error("All role fields must have positions");
    }

    const sourceBytes = await loadOrCreateSourcePdf(template);
    const contentHash = sha256(sourceBytes);

    let version = db
      .prepare(
        "SELECT * FROM template_versions WHERE template_id = ? AND content_hash = ?"
      )
      .get(template.id, contentHash);

    if (!version) {
      const snap = writeBytes(
        "snapshots",
        `${template.id}-${contentHash.slice(0, 12)}.pdf`,
        sourceBytes
      );
      const versionNo =
        (db
          .prepare(
            "SELECT COALESCE(MAX(version_no), 0) AS m FROM template_versions WHERE template_id = ?"
          )
          .get(template.id)?.m || 0) + 1;
      version = {
        id: newId(),
        template_id: template.id,
        version_no: versionNo,
        content_hash: contentHash,
        storage_ref: snap.storageRef,
        fetched_at: now(),
      };
      db.prepare(
        `INSERT INTO template_versions (
          id, template_id, version_no, content_hash, storage_ref, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        version.id,
        version.template_id,
        version.version_no,
        version.content_hash,
        version.storage_ref,
        version.fetched_at
      );
    }

    const snapshotBytes = readBytes(version.storage_ref);
    const bakedDoc = await PDFDocument.load(snapshotBytes);
    const font = await bakedDoc.embedFont(StandardFonts.Helvetica);
    const pages = bakedDoc.getPages();
    const first = pages[0];

    // Stamp entity legal details into footer of first page
    first.drawText(
      `${entity.legal_name} · ${entity.company_number} · ${entity.registered_office}`,
      {
        x: 40,
        y: 28,
        size: 8,
        font,
        color: rgb(0.25, 0.25, 0.25),
      }
    );

    // Overlay field placeholders
    for (const field of fields) {
      const page = pages[Math.min(field.page, pages.length - 1)];
      const { width, height } = page.getSize();
      // template fields stored in points from bottom-left in PDF space
      const x = Number(field.x);
      const y = Number(field.y);
      const w = Number(field.w);
      const h = Number(field.h);
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: rgb(0.05, 0.45, 0.42),
        borderWidth: 1,
        color: rgb(0.85, 0.95, 0.93),
        opacity: 0.35,
        borderOpacity: 0.9,
      });
      page.drawText(field.label || field.field_key, {
        x: x + 3,
        y: y + Math.max(h - 10, 2),
        size: 8,
        font,
        color: rgb(0.05, 0.35, 0.32),
      });
      // silence unused width
      void width;
      void height;
    }

    const bakedBytes = Buffer.from(await bakedDoc.save());
    const bakedFile = writeBytes("baked", `${envelopeId}-baked.pdf`, bakedBytes);

    const docId = newId();
    db.prepare(
      `INSERT INTO documents (id, envelope_id, kind, storage_ref, sha256, size_bytes, created_at)
       VALUES (?, ?, 'baked', ?, ?, ?, ?)`
    ).run(
      docId,
      envelopeId,
      bakedFile.storageRef,
      bakedFile.sha256,
      bakedFile.sizeBytes,
      now()
    );

    db.prepare(
      `UPDATE envelopes SET
        status = 'ready',
        template_version_id = ?,
        baked_document_id = ?,
        baked_hash = ?,
        bake_error = NULL
       WHERE id = ?`
    ).run(version.id, docId, bakedFile.sha256, envelopeId);

    appendEvent({
      envelopeId,
      actor,
      eventType: "envelope_baked",
      metadata: {
        baked_hash: bakedFile.sha256,
        template_version_id: version.id,
        document_id: docId,
      },
    });

    return db.prepare("SELECT * FROM envelopes WHERE id = ?").get(envelopeId);
  } catch (err) {
    db.prepare(
      "UPDATE envelopes SET status = 'draft', bake_error = ? WHERE id = ?"
    ).run(err.message || "Bake failed", envelopeId);
    throw err;
  }
}
