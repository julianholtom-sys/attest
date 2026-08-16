import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, newId, now, sha256, parseJson } from "./db.js";
import { appendEvent } from "./events.js";
import { readBytes, writeBytes } from "./storage.js";

async function loadOrCreateSourcePdf(template) {
  let bytes;
  if (template.source_url.startsWith("local://")) {
    bytes = readBytes(template.source_url.replace("local://", ""));
  } else {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
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

async function pdfFromAsset(asset) {
  if (!asset) return null;
  const bytes = readBytes(asset.storage_ref);
  if ((asset.mime || "").includes("pdf") || asset.storage_ref.endsWith(".pdf")) {
    return PDFDocument.load(bytes);
  }
  // PNG/JPEG cover → single A4 page
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  let image;
  if ((asset.mime || "").includes("png") || asset.storage_ref.endsWith(".png")) {
    image = await doc.embedPng(bytes);
  } else {
    image = await doc.embedJpg(bytes);
  }
  const { width, height } = page.getSize();
  page.drawImage(image, { x: 0, y: 0, width, height });
  return doc;
}

function activeAsset(entityId, kind) {
  return db
    .prepare(
      `SELECT * FROM entity_assets
       WHERE entity_id = ? AND kind = ? AND is_active = 1
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(entityId, kind);
}

export function listAppendices({ industry, entityId, ids } = {}) {
  if (Array.isArray(ids)) {
    if (!ids.length) return [];
    return db
      .prepare(
        `SELECT * FROM appendices
         WHERE is_active = 1 AND id IN (${ids.map(() => "?").join(",")})
         ORDER BY industry, name`
      )
      .all(...ids);
  }
  if (industry) {
    return db
      .prepare(
        `SELECT * FROM appendices
         WHERE is_active = 1
           AND industry = ?
           AND (entity_id IS NULL OR entity_id = ? OR ? IS NULL)
         ORDER BY name ASC`
      )
      .all(industry, entityId || null, entityId || null);
  }
  return db
    .prepare(`SELECT * FROM appendices WHERE is_active = 1 ORDER BY industry, name`)
    .all();
}

export function resolveBrandPack(entityId, { industry = null, appendixIds = [] } = {}) {
  // Covers/logo always come from the sending company's setup (active assets).
  const front = activeAsset(entityId, "front_cover");
  const back = activeAsset(entityId, "back_cover");
  const logo = activeAsset(entityId, "logo");
  const appendices = listAppendices({ ids: appendixIds, industry, entityId });
  return { front, back, logo, industry: industry || null, appendices };
}

export function getMasterTemplate() {
  return (
    db
      .prepare(
        `SELECT * FROM templates
         WHERE is_master = 1 AND is_active = 1
         ORDER BY created_at ASC LIMIT 1`
      )
      .get() ||
    db
      .prepare(`SELECT * FROM templates WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1`)
      .get()
  );
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

    const templateId =
      envelope.template_id ||
      db.prepare("SELECT template_id FROM template_roles WHERE id = ?").get(parties[0].role_id)
        ?.template_id;
    const template = db.prepare("SELECT * FROM templates WHERE id = ?").get(templateId);
    if (!template) throw new Error("Template missing");

    const fields = db
      .prepare("SELECT * FROM template_fields WHERE template_id = ?")
      .all(template.id);
    if (fields.some((f) => f.x == null || f.y == null)) {
      throw new Error("All role fields must have positions");
    }

    const appendixIds = parseJson(envelope.appendix_ids_json, []);
    const brand = resolveBrandPack(entity.id, {
      industry: envelope.industry || template.industry || null,
      appendixIds,
    });
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

    // Assemble: front cover + contract + industry appendices + back cover
    const bakedDoc = await PDFDocument.create();
    const font = await bakedDoc.embedFont(StandardFonts.Helvetica);
    const bold = await bakedDoc.embedFont(StandardFonts.HelveticaBold);

    const frontDoc = await pdfFromAsset(brand.front);
    if (frontDoc) {
      const pages = await bakedDoc.copyPages(frontDoc, frontDoc.getPageIndices());
      pages.forEach((p) => bakedDoc.addPage(p));
    }

    const contractDoc = await PDFDocument.load(readBytes(version.storage_ref));
    const contractStartIndex = bakedDoc.getPageCount();
    const contractPages = await bakedDoc.copyPages(
      contractDoc,
      contractDoc.getPageIndices()
    );
    contractPages.forEach((p) => bakedDoc.addPage(p));
    const contractPageOffset = contractStartIndex;

    // Stamp legal footer + prepared/issued metadata + logo on first contract page
    const firstContract = bakedDoc.getPages()[contractStartIndex];
    if (firstContract) {
      firstContract.drawText(
        `${entity.legal_name} · ${entity.company_number} · ${entity.registered_office}`,
        {
          x: 40,
          y: 28,
          size: 8,
          font,
          color: rgb(0.25, 0.25, 0.25),
        }
      );
      const meta = [
        envelope.prepared_on ? `Prepared ${envelope.prepared_on}` : null,
        envelope.issued_at ? `Issued ${String(envelope.issued_at).slice(0, 10)}` : "Issued on send",
      ]
        .filter(Boolean)
        .join(" · ");
      if (meta) {
        firstContract.drawText(meta, {
          x: 40,
          y: 40,
          size: 8,
          font,
          color: rgb(0.25, 0.25, 0.25),
        });
      }
      if (brand.logo) {
        try {
          const logoBytes = readBytes(brand.logo.storage_ref);
          const logoImage =
            (brand.logo.mime || "").includes("png") || brand.logo.storage_ref.endsWith(".png")
              ? await bakedDoc.embedPng(logoBytes)
              : await bakedDoc.embedJpg(logoBytes);
          firstContract.drawImage(logoImage, {
            x: 480,
            y: 780,
            width: 70,
            height: 28,
          });
        } catch {
          /* logo optional */
        }
      }
    }

    // Field placeholders are positioned on the contract page indices (0-based within contract)
    for (const field of fields) {
      const page = bakedDoc.getPages()[
        Math.min(contractStartIndex + (field.page || 0), bakedDoc.getPageCount() - 1)
      ];
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
    }

    for (const appendix of brand.appendices) {
      const appendixDoc = await PDFDocument.load(readBytes(appendix.storage_ref));
      const pages = await bakedDoc.copyPages(appendixDoc, appendixDoc.getPageIndices());
      pages.forEach((p) => bakedDoc.addPage(p));
    }

    const backDoc = await pdfFromAsset(brand.back);
    if (backDoc) {
      const pages = await bakedDoc.copyPages(backDoc, backDoc.getPageIndices());
      pages.forEach((p) => bakedDoc.addPage(p));
    }

    // If somehow empty, keep contract only
    if (bakedDoc.getPageCount() === 0) {
      throw new Error("Bake produced an empty document");
    }

    void bold;
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
        template_id = ?,
        template_version_id = ?,
        baked_document_id = ?,
        baked_hash = ?,
        front_cover_id = ?,
        back_cover_id = ?,
        logo_asset_id = ?,
        industry = ?,
        appendix_ids_json = ?,
        contract_page_offset = ?,
        bake_error = NULL
       WHERE id = ?`
    ).run(
      template.id,
      version.id,
      docId,
      bakedFile.sha256,
      brand.front?.id || null,
      brand.back?.id || null,
      brand.logo?.id || null,
      brand.industry || envelope.industry || null,
      JSON.stringify(brand.appendices.map((a) => a.id)),
      contractPageOffset,
      envelopeId
    );

    appendEvent({
      envelopeId,
      actor,
      eventType: "envelope_baked",
      metadata: {
        baked_hash: bakedFile.sha256,
        template_version_id: version.id,
        document_id: docId,
        front_cover_id: brand.front?.id || null,
        back_cover_id: brand.back?.id || null,
        logo_asset_id: brand.logo?.id || null,
        appendix_ids: brand.appendices.map((a) => a.id),
        prepared_on: envelope.prepared_on || null,
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

export { parseJson };
