import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, newId, now, sha256, parseJson } from "./db.js";
import { appendEvent, listEvents, verifyEventChain } from "./events.js";
import { bakeEnvelope, resolveBrandPack, getMasterTemplate, listAppendices } from "./bake.js";
import {
  CONSENT_TEXT,
  applySignatureAndCompleteParty,
  evidenceChecklist,
  evidenceGateOpen,
  getActionableParty,
  inviteParty,
  resolveToken,
  startSigningInvites,
} from "./signing.js";
import { ensureSeed } from "./seed.js";
import { seedDefaultEmailTemplates, listOutboundEmails } from "./mail.js";
import { readBytes, writeBytes } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const isProd = process.env.NODE_ENV === "production";
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

function publicBase(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http")
    .toString()
    .split(",")[0]
    .trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`)
    .toString()
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

await ensureSeed();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function clientMeta(req) {
  return {
    ip: req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.socket.remoteAddress,
    userAgent: req.headers["user-agent"] || "unknown",
  };
}

function serializeEntity(row) {
  if (!row) return null;
  return {
    ...row,
    brand: parseJson(row.brand_json, {}),
    domain_verified: Boolean(row.domain_verified),
    is_active: Boolean(row.is_active),
  };
}

function getEnvelopeBundle(id) {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ?").get(id);
  if (!envelope) return null;
  const entity = serializeEntity(
    db.prepare("SELECT * FROM entities WHERE id = ?").get(envelope.entity_id)
  );
  const parties = db
    .prepare(
      `SELECT p.*, r.role_key, r.label AS role_label, r.evidence_required, r.signing_order
       FROM envelope_parties p
       JOIN template_roles r ON r.id = p.role_id
       WHERE p.envelope_id = ?
       ORDER BY p.order_index ASC`
    )
    .all(id)
    .map((p) => ({ ...p, evidence_required: Boolean(p.evidence_required) }));
  const documents = db
    .prepare("SELECT * FROM documents WHERE envelope_id = ? ORDER BY created_at ASC")
    .all(id);
  const events = listEvents(id);
  const emails = listOutboundEmails(id);
  const actionable = getActionableParty(id);
  const template = envelope.template_id
    ? db.prepare("SELECT * FROM templates WHERE id = ?").get(envelope.template_id)
    : null;
  const brand = resolveBrandPack(envelope.entity_id, {
    industry: envelope.industry,
    appendixIds: parseJson(envelope.appendix_ids_json, []),
  });
  const appendixIds = parseJson(envelope.appendix_ids_json, []);
  const appendices = listAppendices({ ids: appendixIds });
  const front = envelope.front_cover_id
    ? db.prepare("SELECT * FROM entity_assets WHERE id = ?").get(envelope.front_cover_id)
    : brand.front;
  const back = envelope.back_cover_id
    ? db.prepare("SELECT * FROM entity_assets WHERE id = ?").get(envelope.back_cover_id)
    : brand.back;
  const logo = envelope.logo_asset_id
    ? db.prepare("SELECT * FROM entity_assets WHERE id = ?").get(envelope.logo_asset_id)
    : brand.logo;
  return {
    ...envelope,
    entity,
    template,
    parties,
    documents,
    events,
    emails,
    actionable_party_id: actionable?.id || null,
    auto_pack: {
      front,
      back,
      logo,
      appendices,
      industry: envelope.industry || brand.industry,
    },
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "attest",
    storage: "local-disk",
    db: "sqlite",
    model: "esign-data-model-local",
  });
});

app.get("/api/bootstrap", (req, res) => {
  const entities = db.prepare("SELECT * FROM entities ORDER BY display_name").all().map(serializeEntity);
  const masterTemplate = getMasterTemplate();
  const templates = db
    .prepare("SELECT * FROM templates WHERE is_active = 1 ORDER BY is_master DESC, name")
    .all();
  const users = db.prepare("SELECT id, email, name, role FROM users WHERE is_active = 1").all();
  const appendices = listAppendices().map((a) => ({
    id: a.id,
    entity_id: a.entity_id,
    industry: a.industry,
    name: a.name,
    description: a.description,
    is_active: a.is_active,
  }));
  const assets = db
    .prepare("SELECT id, entity_id, kind, name, mime, page_size, is_active FROM entity_assets WHERE is_active = 1 ORDER BY kind, name")
    .all();
  const industries = [
    ...new Set(appendices.map((a) => a.industry).filter(Boolean)),
  ].sort();
  res.json({
    entities,
    masterTemplate,
    templates,
    users,
    appendices,
    assets,
    industries,
    baseUrl: publicBase(req),
  });
});

app.get("/api/brand-pack", (req, res) => {
  const entityId = req.query.entityId;
  const industry = req.query.industry || null;
  const appendixIds = String(req.query.appendixIds || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entityId) {
    return res.status(400).json({ error: "entityId required" });
  }
  const pack = resolveBrandPack(entityId, {
    industry,
    appendixIds: appendixIds.length ? appendixIds : [],
  });
  const available = industry ? listAppendices({ industry, entityId }) : [];
  res.json({
    industry: pack.industry,
    front: pack.front
      ? { id: pack.front.id, name: pack.front.name, kind: pack.front.kind }
      : null,
    back: pack.back
      ? { id: pack.back.id, name: pack.back.name, kind: pack.back.kind }
      : null,
    logo: pack.logo
      ? { id: pack.logo.id, name: pack.logo.name, kind: pack.logo.kind }
      : null,
    appendices: pack.appendices.map((a) => ({
      id: a.id,
      name: a.name,
      industry: a.industry,
      description: a.description,
    })),
    availableAppendices: available.map((a) => ({
      id: a.id,
      name: a.name,
      industry: a.industry,
      description: a.description,
    })),
  });
});

app.get("/api/entities", (_req, res) => {
  res.json(
    db
      .prepare("SELECT * FROM entities WHERE is_active = 1 ORDER BY display_name")
      .all()
      .map(serializeEntity)
  );
});

app.get("/api/entities/:id", (req, res) => {
  const entity = serializeEntity(
    db.prepare("SELECT * FROM entities WHERE id = ?").get(req.params.id)
  );
  if (!entity) return res.status(404).json({ error: "Not found" });
  const assets = db
    .prepare(
      "SELECT * FROM entity_assets WHERE entity_id = ? ORDER BY kind, created_at DESC"
    )
    .all(entity.id);
  const pack = resolveBrandPack(entity.id, { industry: null });
  res.json({
    ...entity,
    assets,
    active_pack: {
      front: pack.front,
      back: pack.back,
      logo: pack.logo,
    },
  });
});

app.post("/api/entities", (req, res) => {
  try {
    const body = req.body || {};
    const required = [
      "slug",
      "legal_name",
      "company_number",
      "registered_office",
      "display_name",
      "sending_domain",
      "from_address",
    ];
    for (const key of required) {
      if (!body[key]) return res.status(400).json({ error: `${key} required` });
    }
    if (db.prepare("SELECT id FROM entities WHERE slug = ?").get(body.slug)) {
      return res.status(400).json({ error: "slug already exists" });
    }
    const id = newId();
    db.prepare(
      `INSERT INTO entities (
        id, slug, legal_name, company_number, vat_number, registered_office,
        display_name, brand_json, sending_domain, from_address, reply_to,
        email_signature_html, email_signature_text, domain_verified, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      body.slug,
      body.legal_name,
      body.company_number,
      body.vat_number || null,
      body.registered_office,
      body.display_name,
      JSON.stringify(
        body.brand || {
          primary: "#0074ff",
          secondary: "#101828",
          logo_asset_id: null,
          font: "Manrope",
        }
      ),
      body.sending_domain,
      body.from_address,
      body.reply_to || null,
      body.email_signature_html || `<p>Kind regards,<br/>${body.display_name}</p>`,
      body.email_signature_text || `Kind regards,\n${body.display_name}`,
      body.domain_verified === false ? 0 : 1,
      now()
    );
    const user = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (user) {
      db.prepare(
        "INSERT OR IGNORE INTO user_entity_access (user_id, entity_id) VALUES (?, ?)"
      ).run(user.id, id);
      seedDefaultEmailTemplates(id, user.id);
    }
    res.status(201).json(
      serializeEntity(db.prepare("SELECT * FROM entities WHERE id = ?").get(id))
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/entities/:id", (req, res) => {
  const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(req.params.id);
  if (!entity) return res.status(404).json({ error: "Not found" });
  const body = req.body || {};
  const brand = {
    ...parseJson(entity.brand_json, {}),
    ...(body.brand || {}),
  };
  db.prepare(
    `UPDATE entities SET
      legal_name = ?,
      company_number = ?,
      vat_number = ?,
      registered_office = ?,
      display_name = ?,
      brand_json = ?,
      sending_domain = ?,
      from_address = ?,
      reply_to = ?,
      email_signature_html = ?,
      email_signature_text = ?,
      domain_verified = ?
     WHERE id = ?`
  ).run(
    body.legal_name ?? entity.legal_name,
    body.company_number ?? entity.company_number,
    body.vat_number ?? entity.vat_number,
    body.registered_office ?? entity.registered_office,
    body.display_name ?? entity.display_name,
    JSON.stringify(brand),
    body.sending_domain ?? entity.sending_domain,
    body.from_address ?? entity.from_address,
    body.reply_to ?? entity.reply_to,
    body.email_signature_html ?? entity.email_signature_html,
    body.email_signature_text ?? entity.email_signature_text,
    body.domain_verified === undefined
      ? entity.domain_verified
      : body.domain_verified
        ? 1
        : 0,
    entity.id
  );
  res.json(serializeEntity(db.prepare("SELECT * FROM entities WHERE id = ?").get(entity.id)));
});

app.post("/api/entities/:id/assets", upload.single("file"), (req, res) => {
  try {
    const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(req.params.id);
    if (!entity) return res.status(404).json({ error: "Not found" });
    const kind = req.body.kind;
    if (!["front_cover", "back_cover", "logo", "email_header"].includes(kind)) {
      return res.status(400).json({ error: "Invalid asset kind" });
    }
    if (!req.file) return res.status(400).json({ error: "File required" });
    const stored = writeBytes(
      "assets",
      `${entity.id}-${kind}-${Date.now()}-${req.file.originalname}`,
      req.file.buffer
    );
    // deactivate previous active of same kind so new one becomes the auto-applied default
    db.prepare(
      "UPDATE entity_assets SET is_active = 0 WHERE entity_id = ? AND kind = ?"
    ).run(entity.id, kind);
    const id = newId();
    db.prepare(
      `INSERT INTO entity_assets (
        id, entity_id, kind, name, storage_ref, mime, page_size, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      entity.id,
      kind,
      req.body.name || req.file.originalname,
      stored.storageRef,
      req.file.mimetype,
      req.body.page_size || "A4",
      now()
    );
    if (kind === "logo") {
      const brand = parseJson(entity.brand_json, {});
      brand.logo_asset_id = id;
      db.prepare("UPDATE entities SET brand_json = ? WHERE id = ?").run(
        JSON.stringify(brand),
        entity.id
      );
    }
    res.status(201).json(db.prepare("SELECT * FROM entity_assets WHERE id = ?").get(id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/templates", (_req, res) => {
  const templates = db
    .prepare("SELECT * FROM templates ORDER BY is_master DESC, created_at DESC")
    .all();
  res.json(
    templates.map((t) => ({
      ...t,
      is_master: Boolean(t.is_master),
      roles: db
        .prepare("SELECT * FROM template_roles WHERE template_id = ? ORDER BY signing_order")
        .all(t.id),
      fields: db.prepare("SELECT * FROM template_fields WHERE template_id = ?").all(t.id),
    }))
  );
});

app.get("/api/templates/master", (_req, res) => {
  const t = getMasterTemplate();
  if (!t) return res.status(404).json({ error: "Master contract not found" });
  const roles = db
    .prepare("SELECT * FROM template_roles WHERE template_id = ? ORDER BY signing_order")
    .all(t.id);
  const fields = db.prepare("SELECT * FROM template_fields WHERE template_id = ?").all(t.id);
  res.json({ ...t, is_master: true, roles, fields });
});

app.patch("/api/templates/master", (req, res) => {
  const t = getMasterTemplate();
  if (!t) return res.status(404).json({ error: "Master contract not found" });
  const body = req.body || {};
  db.prepare(
    `UPDATE templates SET
      name = ?,
      description = ?
     WHERE id = ?`
  ).run(body.name ?? t.name, body.description ?? t.description, t.id);
  res.json(db.prepare("SELECT * FROM templates WHERE id = ?").get(t.id));
});

app.post("/api/templates/master/file", upload.single("file"), (req, res) => {
  try {
    let t = getMasterTemplate();
    if (!req.file) return res.status(400).json({ error: "PDF file required" });
    const stored = writeBytes(
      "uploads",
      `master-${Date.now()}-${req.file.originalname}`,
      req.file.buffer
    );
    if (!t) {
      const id = newId();
      db.prepare(
        `INSERT INTO templates (
          id, entity_id, name, source_url, default_front_cover, default_back_cover,
          is_active, created_at, industry, description, is_master
        ) VALUES (?, NULL, ?, ?, NULL, NULL, 1, ?, NULL, ?, 1)`
      ).run(
        id,
        req.body.name || "Master Services Agreement",
        `local://${stored.storageRef}`,
        now(),
        req.body.description || "Core three-party agreement included on every contract"
      );
      // roles added lazily if missing — seed helper not imported; create minimal roles
      const roleDefs = [
        ["company", "Company", 1, 1],
        ["agency", "Agency", 2, 0],
        ["supplier", "Supplier", 3, 0],
      ];
      const roleIds = {};
      for (const [key, label, order, evidence] of roleDefs) {
        const rid = newId();
        roleIds[key] = rid;
        db.prepare(
          `INSERT INTO template_roles (
            id, template_id, role_key, label, signing_order, evidence_required
          ) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(rid, id, key, label, order, evidence);
      }
      for (const [role, key, label, type, x, y, w, h] of [
        ["company", "company_sig", "Company signature", "signature", 50, 190, 180, 36],
        ["company", "company_date", "Date", "date", 250, 198, 120, 20],
        ["agency", "agency_sig", "Agency signature", "signature", 50, 120, 180, 36],
        ["supplier", "supplier_sig", "Supplier signature", "signature", 50, 50, 180, 36],
      ]) {
        db.prepare(
          `INSERT INTO template_fields (
            id, template_id, role_id, field_key, label, field_type, required,
            page, x, y, w, h, validation_json
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, NULL)`
        ).run(newId(), id, roleIds[role], key, label, type, x, y, w, h);
      }
      t = db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
    } else {
      db.prepare("UPDATE templates SET source_url = ?, name = COALESCE(?, name) WHERE id = ?").run(
        `local://${stored.storageRef}`,
        req.body.name || null,
        t.id
      );
      t = db.prepare("SELECT * FROM templates WHERE id = ?").get(t.id);
    }
    res.json(t);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/templates/:id", (req, res) => {
  const t = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Not found" });
  const roles = db
    .prepare("SELECT * FROM template_roles WHERE template_id = ? ORDER BY signing_order")
    .all(t.id)
    .map((role) => ({
      ...role,
      evidence_required: Boolean(role.evidence_required),
      evidence_requirements: db
        .prepare("SELECT * FROM evidence_requirements WHERE role_id = ?")
        .all(role.id)
        .map((r) => ({ ...r, accepted_mimes: JSON.parse(r.accepted_mimes || "[]") })),
    }));
  const fields = db.prepare("SELECT * FROM template_fields WHERE template_id = ?").all(t.id);
  const versions = db
    .prepare(
      "SELECT * FROM template_versions WHERE template_id = ? ORDER BY version_no DESC"
    )
    .all(t.id);
  res.json({ ...t, is_master: Boolean(t.is_master), roles, fields, versions });
});

app.get("/api/appendices", (req, res) => {
  const industry = req.query.industry || null;
  res.json(listAppendices({ industry: industry || undefined }));
});

app.post("/api/appendices", upload.single("file"), (req, res) => {
  try {
    const name = req.body.name;
    const industry = req.body.industry;
    if (!name || !industry) {
      return res.status(400).json({ error: "name and industry required" });
    }
    if (!req.file) return res.status(400).json({ error: "PDF file required" });
    const stored = writeBytes(
      "uploads",
      `appendix-${industry}-${Date.now()}-${req.file.originalname}`,
      req.file.buffer
    );
    const id = newId();
    db.prepare(
      `INSERT INTO appendices (
        id, entity_id, industry, name, description, storage_ref, is_active, created_at
      ) VALUES (?, NULL, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      industry,
      name,
      req.body.description || null,
      stored.storageRef,
      now()
    );
    res.status(201).json(db.prepare("SELECT * FROM appendices WHERE id = ?").get(id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/appendices/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM appendices WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const body = req.body || {};
  db.prepare(
    `UPDATE appendices SET
      name = ?,
      industry = ?,
      description = ?,
      is_active = ?
     WHERE id = ?`
  ).run(
    body.name ?? row.name,
    body.industry ?? row.industry,
    body.description ?? row.description,
    body.is_active === undefined ? row.is_active : body.is_active ? 1 : 0,
    row.id
  );
  res.json(db.prepare("SELECT * FROM appendices WHERE id = ?").get(row.id));
});

app.post("/api/appendices/:id/file", upload.single("file"), (req, res) => {
  try {
    const row = db.prepare("SELECT * FROM appendices WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (!req.file) return res.status(400).json({ error: "PDF file required" });
    const stored = writeBytes(
      "uploads",
      `appendix-${row.industry}-${Date.now()}-${req.file.originalname}`,
      req.file.buffer
    );
    db.prepare("UPDATE appendices SET storage_ref = ? WHERE id = ?").run(
      stored.storageRef,
      row.id
    );
    res.json(db.prepare("SELECT * FROM appendices WHERE id = ?").get(row.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/envelopes", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM envelopes ORDER BY created_at DESC")
    .all()
    .map((e) => {
      const entity = db.prepare("SELECT display_name, slug FROM entities WHERE id = ?").get(e.entity_id);
      const parties = db
        .prepare("SELECT status, role_id FROM envelope_parties WHERE envelope_id = ?")
        .all(e.id);
      return { ...e, entity, party_count: parties.length, parties };
    });
  res.json(rows);
});

app.get("/api/envelopes/:id", (req, res) => {
  const bundle = getEnvelopeBundle(req.params.id);
  if (!bundle) return res.status(404).json({ error: "Not found" });
  res.json(bundle);
});

app.post("/api/envelopes", (req, res) => {
  try {
    const {
      entityId,
      title,
      preparedOn,
      industry,
      appendixIds = [],
      externalClientRef,
      parties,
      reminderFrequency = "none",
    } = req.body || {};
    const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
    if (!entity) return res.status(400).json({ error: "Unknown entity" });
    if (!entity.domain_verified) {
      return res.status(400).json({ error: "Entity domain_verified = false; cannot create envelope" });
    }
    const template = getMasterTemplate();
    if (!template) return res.status(400).json({ error: "Master contract is not configured" });
    if (!preparedOn || !/^\d{4}-\d{2}-\d{2}$/.test(preparedOn)) {
      return res.status(400).json({ error: "preparedOn (YYYY-MM-DD) is required" });
    }
    const selectedIndustry = industry || null;
    const requestedAppendixIds = Array.isArray(appendixIds) ? appendixIds : [];
    const available = selectedIndustry
      ? listAppendices({ industry: selectedIndustry, entityId })
      : [];
    const availableIds = new Set(available.map((a) => a.id));
    for (const id of requestedAppendixIds) {
      if (!availableIds.has(id)) {
        return res.status(400).json({
          error: `Appendix ${id} is not available for industry ${selectedIndustry || "(none)"}`,
        });
      }
    }
    const selectedAppendices = listAppendices({ ids: requestedAppendixIds });
    const brand = resolveBrandPack(entityId, {
      industry: selectedIndustry,
      appendixIds: requestedAppendixIds,
    });
    const roles = db
      .prepare("SELECT * FROM template_roles WHERE template_id = ? ORDER BY signing_order")
      .all(template.id);
    if (roles.length !== 3) {
      return res.status(400).json({ error: "Master contract must define company/agency/supplier roles" });
    }
    if (!Array.isArray(parties) || parties.length !== 3) {
      return res.status(400).json({ error: "Provide exactly three parties" });
    }

    const user = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const envelopeId = newId();
    db.prepare(
      `INSERT INTO envelopes (
        id, entity_id, template_id, status, signing_mode, reminder_frequency, max_auto_reminders,
        external_client_ref, title, prepared_on, industry, front_cover_id, back_cover_id,
        logo_asset_id, appendix_ids_json, created_by, created_at
      ) VALUES (?, ?, ?, 'draft', 'sequential', ?, 5, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      envelopeId,
      entityId,
      template.id,
      reminderFrequency,
      externalClientRef || null,
      title || template.name,
      preparedOn,
      selectedIndustry,
      brand.front?.id || null,
      brand.back?.id || null,
      brand.logo?.id || null,
      JSON.stringify(selectedAppendices.map((a) => a.id)),
      user?.id || null,
      now()
    );

    for (const role of roles) {
      const incoming = parties.find((p) => p.roleKey === role.role_key);
      if (!incoming?.signer_name || !incoming?.signer_email || !incoming?.company_name) {
        throw new Error(`Missing party details for role ${role.role_key}`);
      }
      db.prepare(
        `INSERT INTO envelope_parties (
          id, envelope_id, role_id, company_name, signer_name, signer_email,
          status, order_index
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).run(
        newId(),
        envelopeId,
        role.id,
        incoming.company_name,
        incoming.signer_name,
        incoming.signer_email,
        role.signing_order
      );
    }

    appendEvent({
      envelopeId,
      actor: user ? `staff:${user.id}` : "staff",
      eventType: "envelope_created",
      metadata: {
        template_id: template.id,
        title: title || template.name,
        prepared_on: preparedOn,
        industry: selectedIndustry,
        auto_front_cover_id: brand.front?.id || null,
        auto_back_cover_id: brand.back?.id || null,
        auto_logo_asset_id: brand.logo?.id || null,
        appendix_ids: selectedAppendices.map((a) => a.id),
      },
    });

    res.status(201).json(getEnvelopeBundle(envelopeId));
  } catch (err) {
    res.status(400).json({ error: err.message || "Create failed" });
  }
});

app.post("/api/envelopes/:id/bake", async (req, res) => {
  try {
    await bakeEnvelope(req.params.id, { actor: "staff" });
    res.json(getEnvelopeBundle(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message || "Bake failed" });
  }
});

app.post("/api/envelopes/:id/send", async (req, res) => {
  try {
    const baseUrl = publicBase(req);
    const result = startSigningInvites(req.params.id, baseUrl, "staff");
    res.json({ ...getEnvelopeBundle(req.params.id), invite: result });
  } catch (err) {
    res.status(400).json({ error: err.message || "Send failed" });
  }
});

app.post("/api/envelopes/:id/void", (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ?").get(req.params.id);
  if (!envelope) return res.status(404).json({ error: "Not found" });
  if (["completed", "declined", "voided", "expired"].includes(envelope.status)) {
    return res.status(400).json({ error: "Envelope already terminal" });
  }
  const reason = req.body?.reason || "Voided by staff";
  db.prepare(
    "UPDATE envelopes SET status = 'voided', void_reason = ? WHERE id = ?"
  ).run(reason, envelope.id);
  db.prepare(
    "UPDATE party_access_tokens SET revoked_at = ? WHERE party_id IN (SELECT id FROM envelope_parties WHERE envelope_id = ?) AND revoked_at IS NULL"
  ).run(now(), envelope.id);
  appendEvent({
    envelopeId: envelope.id,
    actor: "staff",
    eventType: "voided",
    metadata: { reason },
  });
  res.json(getEnvelopeBundle(envelope.id));
});

app.get("/api/envelopes/:id/documents/:kind", (req, res) => {
  const doc = db
    .prepare(
      "SELECT * FROM documents WHERE envelope_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(req.params.id, req.params.kind);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${req.params.kind}.pdf"`);
  res.send(readBytes(doc.storage_ref));
});

app.get("/api/events/verify", (req, res) => {
  res.json(verifyEventChain(req.query.envelopeId || null));
});

// Signing room (tokenized)
app.get("/api/sign/:token", (req, res) => {
  const token = resolveToken(req.params.token);
  if (!token) return res.status(401).json({ error: "Invalid or expired token" });
  const { ip, userAgent } = clientMeta(req);
  const party = db.prepare("SELECT * FROM envelope_parties WHERE id = ?").get(token.party_id);
  const envelope = getEnvelopeBundle(token.envelope_id);
  const role = db.prepare("SELECT * FROM template_roles WHERE id = ?").get(party.role_id);
  const fields = db
    .prepare("SELECT * FROM template_fields WHERE role_id = ?")
    .all(party.role_id);
  const values = db
    .prepare("SELECT * FROM field_values WHERE envelope_id = ? AND party_id = ?")
    .all(token.envelope_id, party.id);

  if (party.status === "notified") {
    db.prepare("UPDATE envelope_parties SET status = 'viewed' WHERE id = ?").run(party.id);
    appendEvent({
      envelopeId: token.envelope_id,
      partyId: party.id,
      actor: "party",
      eventType: "document_viewed",
      ip,
      userAgent,
    });
  }

  const checklist = evidenceChecklist(party.id);
  const gate = evidenceGateOpen(party.id);
  const actionable = getActionableParty(token.envelope_id);

  res.json({
    consent_text: CONSENT_TEXT,
    party: { ...party, role_key: role.role_key, role_label: role.label },
    envelope,
    fields,
    values,
    checklist,
    gate,
    is_turn: actionable?.id === party.id,
    document_url: `/api/envelopes/${token.envelope_id}/documents/baked`,
  });
});

app.post("/api/sign/:token/fields", (req, res) => {
  try {
    const token = resolveToken(req.params.token);
    if (!token) return res.status(401).json({ error: "Invalid or expired token" });
    const { fieldId, value } = req.body || {};
    const field = db.prepare("SELECT * FROM template_fields WHERE id = ?").get(fieldId);
    if (!field) return res.status(400).json({ error: "Unknown field" });
    if (field.role_id !== token.role_id) {
      return res.status(403).json({ error: "Field not owned by this role" });
    }
    const { ip } = clientMeta(req);
    const valueHash = sha256(String(value ?? ""));
    const existing = db
      .prepare("SELECT id FROM field_values WHERE envelope_id = ? AND field_id = ?")
      .get(token.envelope_id, fieldId);
    if (existing) {
      db.prepare(
        `UPDATE field_values SET value = ?, value_hash = ?, captured_at = ?, captured_ip = ?, party_id = ?
         WHERE id = ?`
      ).run(String(value ?? ""), valueHash, now(), ip, token.party_id, existing.id);
    } else {
      db.prepare(
        `INSERT INTO field_values (
          id, envelope_id, field_id, party_id, value, value_hash, captured_at, captured_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId(),
        token.envelope_id,
        fieldId,
        token.party_id,
        String(value ?? ""),
        valueHash,
        now(),
        ip
      );
    }
    appendEvent({
      envelopeId: token.envelope_id,
      partyId: token.party_id,
      actor: "party",
      eventType: "field_completed",
      metadata: { field_id: fieldId, field_key: field.field_key },
      ip,
    });
    db.prepare(
      "UPDATE envelope_parties SET status = 'in_progress' WHERE id = ? AND status IN ('viewed','notified')"
    ).run(token.party_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/sign/:token/evidence", upload.single("file"), (req, res) => {
  try {
    const token = resolveToken(req.params.token);
    if (!token) return res.status(401).json({ error: "Invalid or expired token" });
    const requirementId = req.body.requirementId;
    const reqRow = db
      .prepare("SELECT * FROM evidence_requirements WHERE id = ?")
      .get(requirementId);
    if (!reqRow) return res.status(400).json({ error: "Unknown requirement" });
    if (reqRow.role_id !== token.role_id) {
      return res.status(403).json({ error: "Requirement not for this role" });
    }
    if (!req.file) return res.status(400).json({ error: "File required" });
    if (req.file.size > (reqRow.max_size_bytes || 10 * 1024 * 1024)) {
      return res.status(400).json({ error: "File too large" });
    }
    const accepted = JSON.parse(reqRow.accepted_mimes || "[]");
    if (accepted.length && !accepted.includes(req.file.mimetype)) {
      return res.status(400).json({ error: `MIME not accepted: ${req.file.mimetype}` });
    }
    // Basic magic-byte check for PDF / JPEG / PNG
    const buf = req.file.buffer;
    const isPdf = buf.slice(0, 5).toString() === "%PDF-";
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!(isPdf || isJpeg || isPng)) {
      return res.status(400).json({ error: "File content does not match PDF/JPEG/PNG" });
    }

    const stored = writeBytes(
      "evidence",
      `${token.party_id}-${reqRow.requirement_key}-${Date.now()}`,
      buf
    );
    const { ip } = clientMeta(req);
    const id = newId();
    const retention = new Date();
    retention.setFullYear(retention.getFullYear() + 6);
    db.prepare(
      `INSERT INTO evidence_files (
        id, party_id, envelope_id, requirement_id, review_status, original_name,
        mime, size_bytes, storage_ref, file_hash, uploaded_at, uploaded_ip,
        retention_expires_at
      ) VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      token.party_id,
      token.envelope_id,
      requirementId,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      stored.storageRef,
      stored.sha256,
      now(),
      ip,
      retention.toISOString()
    );
    appendEvent({
      envelopeId: token.envelope_id,
      partyId: token.party_id,
      actor: "party",
      eventType: "evidence_uploaded",
      metadata: {
        requirement_key: reqRow.requirement_key,
        evidence_file_id: id,
        file_hash: stored.sha256,
      },
      ip,
    });
    res.status(201).json({
      ok: true,
      checklist: evidenceChecklist(token.party_id),
      gate: evidenceGateOpen(token.party_id),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/sign/:token/sign", async (req, res) => {
  try {
    const token = resolveToken(req.params.token);
    if (!token) return res.status(401).json({ error: "Invalid or expired token" });
    const { signatureDataUrl, method = "drawn", typedName, consent } = req.body || {};
    if (!consent) return res.status(400).json({ error: "Consent required" });
    if (!signatureDataUrl) return res.status(400).json({ error: "Signature required" });
    const { ip, userAgent } = clientMeta(req);

    const result = await applySignatureAndCompleteParty({
      envelopeId: token.envelope_id,
      partyId: token.party_id,
      method,
      signatureDataUrl,
      typedName,
      ip,
      userAgent,
      tokenRow: token,
    });

    if (result.nextPartyId) {
      inviteParty(token.envelope_id, result.nextPartyId, {
        baseUrl: publicBase(req),
        actor: "system",
      });
    }

    res.json({
      ok: true,
      ...result,
      envelope: getEnvelopeBundle(token.envelope_id),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Sign failed" });
  }
});

app.post("/api/sign/:token/decline", (req, res) => {
  const token = resolveToken(req.params.token);
  if (!token) return res.status(401).json({ error: "Invalid or expired token" });
  const reason = req.body?.reason || "Declined";
  const { ip, userAgent } = clientMeta(req);
  db.prepare(
    "UPDATE envelope_parties SET status = 'declined', declined_reason = ? WHERE id = ?"
  ).run(reason, token.party_id);
  db.prepare("UPDATE envelopes SET status = 'declined' WHERE id = ?").run(token.envelope_id);
  db.prepare(
    "UPDATE party_access_tokens SET revoked_at = ? WHERE party_id IN (SELECT id FROM envelope_parties WHERE envelope_id = ?)"
  ).run(now(), token.envelope_id);
  appendEvent({
    envelopeId: token.envelope_id,
    partyId: token.party_id,
    actor: "party",
    eventType: "declined",
    metadata: { reason },
    ip,
    userAgent,
  });
  res.json(getEnvelopeBundle(token.envelope_id));
});

// Dev helper: mint a fresh link for a party (staff)
app.post("/api/envelopes/:id/parties/:partyId/link", (req, res) => {
  try {
    const result = inviteParty(req.params.id, req.params.partyId, {
      baseUrl: publicBase(req),
      actor: "staff",
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

if (isProd) {
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Request failed" });
});

app.listen(PORT, () => {
  console.log(`Attest API on http://localhost:${PORT}`);
  console.log(`Public base URL: ${BASE_URL}`);
});
