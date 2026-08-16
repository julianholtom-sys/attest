import { db, newId, now } from "./db.js";
import { seedDefaultEmailTemplates } from "./mail.js";
import { writeBytes } from "./storage.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { appendEvent } from "./events.js";
import { migrate } from "./migrate.js";

async function makePdf({ title, subtitle, lines = [], footer }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(title, { x: 50, y: 780, size: 20, font: bold });
  if (subtitle) page.drawText(subtitle, { x: 50, y: 752, size: 12, font });
  let y = 720;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 18;
  }
  if (footer) {
    page.drawText(footer, { x: 50, y: 40, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  }
  return Buffer.from(await doc.save());
}

async function makeCoverPdf(label, color) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(color[0], color[1], color[2]),
  });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(label, {
    x: 50,
    y: height / 2,
    size: 28,
    font: bold,
    color: rgb(1, 1, 1),
  });
  return Buffer.from(await doc.save());
}

async function makeLogoPng() {
  const { deflateSync } = await import("node:zlib");
  const w = 96;
  const h = 32;
  const row = Buffer.alloc(1 + w * 3);
  row[0] = 0;
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = 13;
    row[2 + x * 3] = 115;
    row[3 + x * 3] = 112;
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.from(row)));
  const compressed = deflateSync(raw);
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    return ~c;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function addRolesAndFields(templateId, withEvidence) {
  const roles = [
    { key: "company", label: "Company", order: 1, evidence: withEvidence ? 1 : 0 },
    { key: "agency", label: "Agency", order: 2, evidence: 0 },
    { key: "supplier", label: "Supplier", order: 3, evidence: 0 },
  ];
  const roleIds = {};
  for (const role of roles) {
    const id = newId();
    roleIds[role.key] = id;
    db.prepare(
      `INSERT INTO template_roles (
        id, template_id, role_key, label, signing_order, evidence_required
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, templateId, role.key, role.label, role.order, role.evidence);
  }

  if (withEvidence) {
    const evidence = [
      ["proof_of_address", "Proof of company address", "upload"],
      ["proof_of_directors", "Proof of directors", "upload"],
      ["vat_certificate", "VAT certificate", "upload"],
      ["incorporation_cert", "Certificate of incorporation", "upload"],
    ];
    for (const [key, label, method] of evidence) {
      db.prepare(
        `INSERT INTO evidence_requirements (
          id, role_id, requirement_key, label, description, accepted_mimes,
          max_size_bytes, verify_method, is_required
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).run(
        newId(),
        roleIds.company,
        key,
        label,
        label,
        JSON.stringify(["application/pdf", "image/jpeg", "image/png"]),
        10 * 1024 * 1024,
        method
      );
    }
  }

  const fields = [
    { role: "company", key: "company_sig", label: "Company signature", type: "signature", x: 50, y: 190, w: 180, h: 36 },
    { role: "company", key: "company_date", label: "Date", type: "date", x: 250, y: 198, w: 120, h: 20 },
    { role: "agency", key: "agency_sig", label: "Agency signature", type: "signature", x: 50, y: 120, w: 180, h: 36 },
    { role: "supplier", key: "supplier_sig", label: "Supplier signature", type: "signature", x: 50, y: 50, w: 180, h: 36 },
  ];
  for (const f of fields) {
    db.prepare(
      `INSERT INTO template_fields (
        id, template_id, role_id, field_key, label, field_type, required,
        page, x, y, w, h, validation_json
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, NULL)`
    ).run(newId(), templateId, roleIds[f.role], f.key, f.label, f.type, f.x, f.y, f.w, f.h);
  }
  return roleIds;
}

async function ensureEntityBrand(entityId) {
  const existing = db
    .prepare("SELECT id FROM entity_assets WHERE entity_id = ? LIMIT 1")
    .get(entityId);
  if (existing) return;

  const front = writeBytes(
    "assets",
    `${entityId}-front.pdf`,
    await makeCoverPdf("Acme Front Cover", [0.05, 0.45, 0.44])
  );
  const back = writeBytes(
    "assets",
    `${entityId}-back.pdf`,
    await makeCoverPdf("Acme Back Cover", [0.06, 0.14, 0.17])
  );
  const logo = writeBytes("assets", `${entityId}-logo.png`, await makeLogoPng());

  const frontId = newId();
  const backId = newId();
  const logoId = newId();
  const insert = db.prepare(
    `INSERT INTO entity_assets (
      id, entity_id, kind, name, storage_ref, mime, page_size, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'A4', 1, ?)`
  );
  insert.run(frontId, entityId, "front_cover", "Formal Teal Front", front.storageRef, "application/pdf", now());
  insert.run(backId, entityId, "back_cover", "Formal Ink Back", back.storageRef, "application/pdf", now());
  insert.run(logoId, entityId, "logo", "Acme Logo", logo.storageRef, "image/png", now());

  const entity = db.prepare("SELECT brand_json FROM entities WHERE id = ?").get(entityId);
  const brand = JSON.parse(entity.brand_json || "{}");
  brand.logo_asset_id = logoId;
  db.prepare("UPDATE entities SET brand_json = ? WHERE id = ?").run(
    JSON.stringify(brand),
    entityId
  );

  // Point active templates at default covers
  db.prepare(
    `UPDATE templates SET default_front_cover = ?, default_back_cover = ?
     WHERE entity_id = ? AND default_front_cover IS NULL`
  ).run(frontId, backId, entityId);
}

async function ensureCatalog(entityId) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM templates").get().c;
  if (count >= 3 && db.prepare("SELECT COUNT(*) AS c FROM appendices").get().c >= 2) {
    await ensureEntityBrand(entityId);
    return;
  }

  await ensureEntityBrand(entityId);
  const front = db
    .prepare(
      "SELECT id FROM entity_assets WHERE entity_id = ? AND kind = 'front_cover' LIMIT 1"
    )
    .get(entityId);
  const back = db
    .prepare(
      "SELECT id FROM entity_assets WHERE entity_id = ? AND kind = 'back_cover' LIMIT 1"
    )
    .get(entityId);

  const contracts = [
    {
      industry: "construction",
      name: "Construction Services Agreement",
      description: "Works, variations, and site access terms",
    },
    {
      industry: "healthcare",
      name: "Healthcare Supplier Agreement",
      description: "Clinical supply and confidentiality schedule",
    },
    {
      industry: "technology",
      name: "Technology Master Services Agreement",
      description: "Software services and data processing terms",
    },
  ];

  for (const c of contracts) {
    const exists = db
      .prepare("SELECT id FROM templates WHERE name = ? AND entity_id = ?")
      .get(c.name, entityId);
    if (exists) continue;
    const pdf = await makePdf({
      title: c.name,
      subtitle: `${c.industry} · three-party execution`,
      lines: [
        c.description,
        "Company / Agency / Supplier execution blocks appear below.",
        "",
        "Company signature",
        "Agency signature",
        "Supplier signature",
      ],
      footer: "Contract body snapshot",
    });
    const uploaded = writeBytes("uploads", `${c.industry}-contract.pdf`, pdf);
    const templateId = newId();
    db.prepare(
      `INSERT INTO templates (
        id, entity_id, name, source_url, default_front_cover, default_back_cover,
        is_active, created_at, industry, description
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      templateId,
      entityId,
      c.name,
      `local://${uploaded.storageRef}`,
      front?.id || null,
      back?.id || null,
      now(),
      c.industry,
      c.description
    );
    addRolesAndFields(templateId, true);
  }

  // Upgrade legacy MSA if present
  db.prepare(
    `UPDATE templates SET industry = COALESCE(industry, 'technology'),
      description = COALESCE(description, 'General services agreement')
     WHERE industry IS NULL`
  ).run();

  const appendixDefs = [
    {
      industry: "construction",
      name: "Construction H&S Appendix",
      lines: ["Site induction", "PPE requirements", "Permit to work"],
    },
    {
      industry: "construction",
      name: "Construction Payment Schedule",
      lines: ["Valuation dates", "Retention", "Pay-less notices"],
    },
    {
      industry: "healthcare",
      name: "Clinical Governance Appendix",
      lines: ["Safeguarding", "Incident reporting", "Data retention"],
    },
    {
      industry: "technology",
      name: "Data Processing Appendix",
      lines: ["Subprocessors", "Security controls", "Breach notification"],
    },
  ];
  for (const a of appendixDefs) {
    const exists = db
      .prepare("SELECT id FROM appendices WHERE name = ? AND industry = ?")
      .get(a.name, a.industry);
    if (exists) continue;
    const pdf = await makePdf({
      title: a.name,
      subtitle: `Auto-attached for ${a.industry}`,
      lines: a.lines,
    });
    const stored = writeBytes("uploads", `${a.industry}-${a.name}.pdf`, pdf);
    db.prepare(
      `INSERT INTO appendices (
        id, entity_id, industry, name, description, storage_ref, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      newId(),
      entityId,
      a.industry,
      a.name,
      `Industry appendix for ${a.industry}`,
      stored.storageRef,
      now()
    );
  }
}

export async function ensureSeed() {
  migrate();
  const existing = db.prepare("SELECT id FROM entities LIMIT 1").get();
  if (existing) {
    await ensureCatalog(existing.id);
    return { seeded: false, upgraded: true, entityId: existing.id };
  }

  const userId = newId();
  db.prepare(
    `INSERT INTO users (id, email, name, role, is_active, created_at)
     VALUES (?, ?, ?, 'admin', 1, ?)`
  ).run(userId, "ops@attest.local", "Attest Operator", now());

  const entityId = newId();
  db.prepare(
    `INSERT INTO entities (
      id, slug, legal_name, company_number, vat_number, registered_office,
      display_name, brand_json, sending_domain, from_address, reply_to,
      email_signature_html, email_signature_text, domain_verified, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
  ).run(
    entityId,
    "acme",
    "Acme Contracting Limited",
    "12345678",
    "GB123456789",
    "1 Example Street, London, EC1A 1BB",
    "Acme",
    JSON.stringify({
      primary: "#0d7370",
      secondary: "#10242b",
      logo_asset_id: null,
      font: "Outfit",
    }),
    "acme.local",
    "documents@acme.local",
    "ops@acme.local",
    "<p>Kind regards,<br/>Acme Contracting</p>",
    "Kind regards,\nAcme Contracting",
    now()
  );

  db.prepare(
    "INSERT INTO user_entity_access (user_id, entity_id) VALUES (?, ?)"
  ).run(userId, entityId);
  seedDefaultEmailTemplates(entityId, userId);
  await ensureCatalog(entityId);

  appendEvent({
    actor: "system",
    eventType: "webhook_delivered",
    metadata: { note: "seed_complete", entity_id: entityId },
  });

  return { seeded: true, entityId, userId };
}
