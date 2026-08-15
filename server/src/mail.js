import { db, newId, now, sha256, parseJson } from "./db.js";
import { appendEvent } from "./events.js";

const REQUIRED_LINK_TYPES = new Set([
  "invitation",
  "resend",
  "turn_notification",
]);

const MERGE_VARS = [
  "signer_name",
  "signer_company",
  "entity_display_name",
  "envelope_title",
  "signing_link",
  "expiry_date",
  "role_label",
  "declined_by",
  "decline_reason",
];

export function renderTemplate(text, vars) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    if (!(key in vars)) {
      throw new Error(`Unknown merge variable {{${key}}}`);
    }
    return vars[key] ?? "";
  });
}

export function validateTemplateContent(templateType, subject, bodyHtml, bodyText) {
  const combined = `${subject}\n${bodyHtml}\n${bodyText}`;
  const found = [...combined.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  for (const key of found) {
    if (!MERGE_VARS.includes(key)) {
      throw new Error(`Unknown merge variable {{${key}}}`);
    }
  }
  if (REQUIRED_LINK_TYPES.has(templateType) && !found.includes("signing_link")) {
    throw new Error(`{{signing_link}} is mandatory for ${templateType}`);
  }
}

export function sendTemplatedEmail({
  entityId,
  templateType,
  to,
  vars,
  envelopeId = null,
  partyId = null,
  actor = "system",
}) {
  const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
  if (!entity) throw new Error("Entity not found");
  const tpl = db
    .prepare(
      `SELECT * FROM email_templates
       WHERE entity_id = ? AND template_type = ? AND is_active = 1`
    )
    .get(entityId, templateType);
  if (!tpl) throw new Error(`Missing email template: ${templateType}`);

  const subject = renderTemplate(tpl.subject, vars);
  const bodyHtml =
    renderTemplate(tpl.body_html, vars) + "\n" + entity.email_signature_html;
  const bodyText =
    renderTemplate(tpl.body_text, vars) + "\n" + entity.email_signature_text;
  const contentHash = sha256(`${subject}\n${bodyHtml}\n${bodyText}`);

  const id = newId();
  db.prepare(
    `INSERT INTO outbound_emails (
      id, envelope_id, party_id, template_type, to_address,
      subject, body_html, body_text, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    envelopeId,
    partyId,
    templateType,
    to,
    subject,
    bodyHtml,
    bodyText,
    contentHash,
    now()
  );

  // Local mode: no external mail provider — emails are persisted for inspection.
  console.log(`[mail:${templateType}] to=${to} subject=${subject}`);

  appendEvent({
    envelopeId,
    partyId,
    actor,
    eventType:
      templateType === "invitation"
        ? "invitation_sent"
        : templateType === "resend"
          ? "invitation_resent"
          : templateType === "reminder"
            ? "reminder_sent"
            : `${templateType}_sent`,
    metadata: {
      template_id: tpl.id,
      template_type: templateType,
      content_hash: contentHash,
      to,
      local_only: true,
    },
  });

  return { id, contentHash, subject };
}

export function seedDefaultEmailTemplates(entityId, userId = null) {
  const defaults = [
    {
      type: "invitation",
      subject: "{{entity_display_name}}: please sign {{envelope_title}}",
      html: "<p>Hi {{signer_name}},</p><p>Please sign <strong>{{envelope_title}}</strong>.</p><p><a href=\"{{signing_link}}\">Open signing link</a></p>",
      text: "Hi {{signer_name}}, please sign {{envelope_title}}: {{signing_link}}",
    },
    {
      type: "resend",
      subject: "Reminder: sign {{envelope_title}}",
      html: "<p>Hi {{signer_name}},</p><p>Your signing link was reissued.</p><p><a href=\"{{signing_link}}\">Continue</a></p>",
      text: "Hi {{signer_name}}, continue signing: {{signing_link}}",
    },
    {
      type: "reminder",
      subject: "Still waiting on {{envelope_title}}",
      html: "<p>Hi {{signer_name}},</p><p>This is a reminder to complete {{envelope_title}}.</p><p><a href=\"{{signing_link}}\">Sign now</a></p>",
      text: "Reminder for {{envelope_title}}: {{signing_link}}",
    },
    {
      type: "turn_notification",
      subject: "Your turn to sign {{envelope_title}}",
      html: "<p>Hi {{signer_name}},</p><p>It is now your turn ({{role_label}}).</p><p><a href=\"{{signing_link}}\">Open document</a></p>",
      text: "Your turn ({{role_label}}): {{signing_link}}",
    },
    {
      type: "declined_notice",
      subject: "{{envelope_title}} was declined",
      html: "<p>{{declined_by}} declined {{envelope_title}}.</p><p>Reason: {{decline_reason}}</p>",
      text: "{{declined_by}} declined {{envelope_title}}: {{decline_reason}}",
    },
    {
      type: "voided_notice",
      subject: "{{envelope_title}} was voided",
      html: "<p>{{envelope_title}} from {{entity_display_name}} was voided.</p>",
      text: "{{envelope_title}} was voided.",
    },
    {
      type: "completion",
      subject: "Completed: {{envelope_title}}",
      html: "<p>{{envelope_title}} is complete. Completed copies are attached in the local store.</p>",
      text: "{{envelope_title}} is complete.",
    },
  ];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO email_templates (
      id, entity_id, template_type, subject, body_html, body_text,
      is_active, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  for (const d of defaults) {
    validateTemplateContent(d.type, d.subject, d.html, d.text);
    insert.run(newId(), entityId, d.type, d.subject, d.html, d.text, userId, now());
  }
}

export function listOutboundEmails(envelopeId) {
  return db
    .prepare(
      "SELECT * FROM outbound_emails WHERE envelope_id = ? ORDER BY created_at DESC"
    )
    .all(envelopeId);
}
