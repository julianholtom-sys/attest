import { db, newId, now } from "./db.js";
import { seedDefaultEmailTemplates } from "./mail.js";
import { writeBytes } from "./storage.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { appendEvent } from "./events.js";

async function makeSampleContractPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Master Services Agreement", {
    x: 50,
    y: 780,
    size: 20,
    font: bold,
  });
  page.drawText("Three-party local Attest sample contract.", {
    x: 50,
    y: 750,
    size: 12,
    font,
  });
  page.drawText("Company / Agency / Supplier execution blocks appear below.", {
    x: 50,
    y: 730,
    size: 11,
    font,
  });
  page.drawText("Company signature", { x: 50, y: 220, size: 11, font });
  page.drawText("Agency signature", { x: 50, y: 150, size: 11, font });
  page.drawText("Supplier signature", { x: 50, y: 80, size: 11, font });
  return Buffer.from(await doc.save());
}

export async function ensureSeed() {
  const existing = db.prepare("SELECT id FROM entities LIMIT 1").get();
  if (existing) return { seeded: false };

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

  const pdf = await makeSampleContractPdf();
  const uploaded = writeBytes("uploads", "sample-msa.pdf", pdf);

  const templateId = newId();
  db.prepare(
    `INSERT INTO templates (
      id, entity_id, name, source_url, is_active, created_at
    ) VALUES (?, ?, ?, ?, 1, ?)`
  ).run(
    templateId,
    entityId,
    "Master Services Agreement",
    `local://${uploaded.storageRef}`,
    now()
  );

  const roles = [
    { key: "company", label: "Company", order: 1, evidence: 1 },
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

  const evidence = [
    {
      key: "proof_of_address",
      label: "Proof of company address",
      description: "Utility bill or bank statement showing registered office",
      method: "upload",
    },
    {
      key: "proof_of_directors",
      label: "Proof of directors",
      description: "Director listing or Companies House confirmation",
      method: "upload",
    },
    {
      key: "vat_certificate",
      label: "VAT certificate",
      description: "HMRC VAT registration evidence",
      method: "upload",
    },
    {
      key: "incorporation_cert",
      label: "Certificate of incorporation",
      description: "Companies House incorporation certificate",
      method: "upload",
    },
  ];
  for (const item of evidence) {
    db.prepare(
      `INSERT INTO evidence_requirements (
        id, role_id, requirement_key, label, description, accepted_mimes,
        max_size_bytes, verify_method, is_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      newId(),
      roleIds.company,
      item.key,
      item.label,
      item.description,
      JSON.stringify(["application/pdf", "image/jpeg", "image/png"]),
      10 * 1024 * 1024,
      item.method
    );
  }

  // Field positions in PDF points (A4, origin bottom-left)
  const fields = [
    {
      role: "company",
      key: "company_sig",
      label: "Company signature",
      type: "signature",
      x: 50,
      y: 190,
      w: 180,
      h: 36,
    },
    {
      role: "company",
      key: "company_date",
      label: "Date",
      type: "date",
      x: 250,
      y: 198,
      w: 120,
      h: 20,
    },
    {
      role: "agency",
      key: "agency_sig",
      label: "Agency signature",
      type: "signature",
      x: 50,
      y: 120,
      w: 180,
      h: 36,
    },
    {
      role: "supplier",
      key: "supplier_sig",
      label: "Supplier signature",
      type: "signature",
      x: 50,
      y: 50,
      w: 180,
      h: 36,
    },
  ];
  for (const f of fields) {
    db.prepare(
      `INSERT INTO template_fields (
        id, template_id, role_id, field_key, label, field_type, required,
        page, x, y, w, h, validation_json
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, NULL)`
    ).run(
      newId(),
      templateId,
      roleIds[f.role],
      f.key,
      f.label,
      f.type,
      f.x,
      f.y,
      f.w,
      f.h
    );
  }

  appendEvent({
    actor: "system",
    eventType: "webhook_delivered",
    metadata: { note: "seed_complete", entity_id: entityId, template_id: templateId },
  });

  return { seeded: true, entityId, templateId, userId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSeed().then((r) => {
    console.log(r);
  });
}
