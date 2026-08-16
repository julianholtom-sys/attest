import { db, newId, now } from "./db.js";
import { seedDefaultEmailTemplates } from "./mail.js";
import { writeBytes } from "./storage.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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

async function ensureEntityBrand(entityId, brandSpec) {
  const existing = db
    .prepare("SELECT id FROM entity_assets WHERE entity_id = ? LIMIT 1")
    .get(entityId);
  if (existing) return;

  const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
  const label = brandSpec?.label || entity.display_name;
  const frontColor = brandSpec?.frontColor || [0.05, 0.45, 0.44];
  const backColor = brandSpec?.backColor || [0.06, 0.14, 0.17];

  const front = writeBytes(
    "assets",
    `${entityId}-front.pdf`,
    await makeCoverPdf(`${label} Front Cover`, frontColor)
  );
  const back = writeBytes(
    "assets",
    `${entityId}-back.pdf`,
    await makeCoverPdf(`${label} Back Cover`, backColor)
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
  insert.run(
    frontId,
    entityId,
    "front_cover",
    `${label} Front`,
    front.storageRef,
    "application/pdf",
    now()
  );
  insert.run(
    backId,
    entityId,
    "back_cover",
    `${label} Back`,
    back.storageRef,
    "application/pdf",
    now()
  );
  insert.run(
    logoId,
    entityId,
    "logo",
    `${label} Logo`,
    logo.storageRef,
    "image/png",
    now()
  );

  const brand = JSON.parse(entity.brand_json || "{}");
  brand.logo_asset_id = logoId;
  if (brandSpec?.primary) brand.primary = brandSpec.primary;
  if (brandSpec?.secondary) brand.secondary = brandSpec.secondary;
  db.prepare("UPDATE entities SET brand_json = ? WHERE id = ?").run(
    JSON.stringify(brand),
    entityId
  );
}

async function ensureSharedCatalog() {
  // One master contract always sent; industry needs are optional appendices.
  let master = db.prepare("SELECT * FROM templates WHERE is_master = 1 LIMIT 1").get();
  if (!master) {
    const byName = db
      .prepare("SELECT * FROM templates WHERE name = ? LIMIT 1")
      .get("Master Services Agreement");
    if (byName) {
      db.prepare(
        `UPDATE templates SET is_master = 1, is_active = 1, entity_id = NULL,
          industry = NULL, description = ?, default_front_cover = NULL, default_back_cover = NULL
         WHERE id = ?`
      ).run("Core three-party agreement included on every contract", byName.id);
      master = db.prepare("SELECT * FROM templates WHERE id = ?").get(byName.id);
    }
  }

  if (!master) {
    const pdf = await makePdf({
      title: "Master Services Agreement",
      subtitle: "Always included · three-party execution",
      lines: [
        "This master contract is sent with every envelope.",
        "Industry-specific schedules are attached as optional appendices.",
        "",
        "Company / Agency / Supplier execution blocks appear below.",
        "",
        "Company signature",
        "Agency signature",
        "Supplier signature",
      ],
      footer: "Master contract template",
    });
    const uploaded = writeBytes("uploads", "master-services-agreement.pdf", pdf);
    const templateId = newId();
    db.prepare(
      `INSERT INTO templates (
        id, entity_id, name, source_url, default_front_cover, default_back_cover,
        is_active, created_at, industry, description, is_master
      ) VALUES (?, NULL, ?, ?, NULL, NULL, 1, ?, NULL, ?, 1)`
    ).run(
      templateId,
      "Master Services Agreement",
      `local://${uploaded.storageRef}`,
      now(),
      "Core three-party agreement included on every contract"
    );
    addRolesAndFields(templateId, true);
    master = db.prepare("SELECT * FROM templates WHERE id = ?").get(templateId);
  } else {
    db.prepare(
      `UPDATE templates SET is_master = 1, is_active = 1, entity_id = NULL,
        industry = NULL, default_front_cover = NULL, default_back_cover = NULL,
        description = COALESCE(description, ?)
       WHERE id = ?`
    ).run("Core three-party agreement included on every contract", master.id);
  }

  // Demote legacy per-industry “contracts” — those belong as appendices, not masters.
  db.prepare(
    `UPDATE templates SET is_active = 0, is_master = 0
     WHERE id != ? AND (industry IS NOT NULL OR is_master = 0)`
  ).run(master.id);
  db.prepare(`UPDATE templates SET is_master = 0 WHERE id != ?`).run(master.id);

  const roleCount = db
    .prepare("SELECT COUNT(*) AS c FROM template_roles WHERE template_id = ?")
    .get(master.id).c;
  if (!roleCount) addRolesAndFields(master.id, true);

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
      subtitle: `Optional ${a.industry} appendix`,
      lines: a.lines,
    });
    const stored = writeBytes("uploads", `${a.industry}-${a.name}.pdf`, pdf);
    db.prepare(
      `INSERT INTO appendices (
        id, entity_id, industry, name, description, storage_ref, is_active, created_at
      ) VALUES (?, NULL, ?, ?, ?, ?, 1, ?)`
    ).run(
      newId(),
      a.industry,
      a.name,
      `Optional industry appendix for ${a.industry}`,
      stored.storageRef,
      now()
    );
  }
}

const COMPANY_DEFS = [
  {
    slug: "acme",
    legal_name: "Acme Contracting Limited",
    company_number: "12345678",
    vat_number: "GB123456789",
    registered_office: "1 Example Street, London, EC1A 1BB",
    display_name: "Acme",
    sending_domain: "acme.local",
    from_address: "documents@acme.local",
    brand: {
      primary: "#0d7370",
      secondary: "#10242b",
      frontColor: [0.05, 0.45, 0.44],
      backColor: [0.06, 0.14, 0.17],
    },
  },
  {
    slug: "northwind",
    legal_name: "Northwind Facilities Ltd",
    company_number: "23456789",
    vat_number: "GB234567890",
    registered_office: "22 Harbour Road, Bristol, BS1 4ST",
    display_name: "Northwind",
    sending_domain: "northwind.local",
    from_address: "contracts@northwind.local",
    brand: {
      primary: "#1f4e79",
      secondary: "#0b1f33",
      frontColor: [0.12, 0.3, 0.47],
      backColor: [0.04, 0.12, 0.2],
    },
  },
  {
    slug: "contoso",
    legal_name: "Contoso Health Group PLC",
    company_number: "34567890",
    vat_number: "GB345678901",
    registered_office: "8 Clinic Way, Manchester, M1 2AB",
    display_name: "Contoso Health",
    sending_domain: "contoso.local",
    from_address: "esign@contoso.local",
    brand: {
      primary: "#7a1f3d",
      secondary: "#2a0f18",
      frontColor: [0.48, 0.12, 0.24],
      backColor: [0.16, 0.06, 0.09],
    },
  },
  {
    slug: "fabrikam",
    legal_name: "Fabrikam Technology Limited",
    company_number: "45678901",
    vat_number: "GB456789012",
    registered_office: "100 Silicon Quay, Cambridge, CB2 1AA",
    display_name: "Fabrikam",
    sending_domain: "fabrikam.local",
    from_address: "legal@fabrikam.local",
    brand: {
      primary: "#5b4b8a",
      secondary: "#1d1830",
      frontColor: [0.36, 0.29, 0.54],
      backColor: [0.11, 0.09, 0.19],
    },
  },
  {
    slug: "adventureworks",
    legal_name: "Adventure Works Construction Ltd",
    company_number: "56789012",
    vat_number: "GB567890123",
    registered_office: "14 Yard Lane, Leeds, LS1 4DY",
    display_name: "Adventure Works",
    sending_domain: "adventureworks.local",
    from_address: "docs@adventureworks.local",
    brand: {
      primary: "#8a5a12",
      secondary: "#2b1d08",
      frontColor: [0.54, 0.35, 0.07],
      backColor: [0.17, 0.11, 0.03],
    },
  },
];

async function ensureCompanies(userId) {
  for (const def of COMPANY_DEFS) {
    let entity = db.prepare("SELECT * FROM entities WHERE slug = ?").get(def.slug);
    if (!entity) {
      const entityId = newId();
      db.prepare(
        `INSERT INTO entities (
          id, slug, legal_name, company_number, vat_number, registered_office,
          display_name, brand_json, sending_domain, from_address, reply_to,
          email_signature_html, email_signature_text, domain_verified, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
      ).run(
        entityId,
        def.slug,
        def.legal_name,
        def.company_number,
        def.vat_number,
        def.registered_office,
        def.display_name,
        JSON.stringify({
          primary: def.brand.primary,
          secondary: def.brand.secondary,
          logo_asset_id: null,
          font: "Outfit",
        }),
        def.sending_domain,
        def.from_address,
        `ops@${def.sending_domain}`,
        `<p>Kind regards,<br/>${def.display_name}</p>`,
        `Kind regards,\n${def.display_name}`,
        now()
      );
      if (userId) {
        db.prepare(
          "INSERT OR IGNORE INTO user_entity_access (user_id, entity_id) VALUES (?, ?)"
        ).run(userId, entityId);
      }
      seedDefaultEmailTemplates(entityId, userId);
      entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
    }
    await ensureEntityBrand(entity.id, {
      label: def.display_name,
      primary: def.brand.primary,
      secondary: def.brand.secondary,
      frontColor: def.brand.frontColor,
      backColor: def.brand.backColor,
    });
  }
}

export async function ensureSeed() {
  migrate();
  let user = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!user) {
    const userId = newId();
    db.prepare(
      `INSERT INTO users (id, email, name, role, is_active, created_at)
       VALUES (?, ?, ?, 'admin', 1, ?)`
    ).run(userId, "ops@attest.local", "Attest Operator", now());
    user = { id: userId };
  }

  await ensureCompanies(user.id);
  await ensureSharedCatalog();

  const count = db.prepare("SELECT COUNT(*) AS c FROM entities").get().c;
  return { seeded: true, companies: count, userId: user.id };
}
