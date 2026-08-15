import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  UPLOADS_DIR,
  SIGNED_DIR,
  listEnvelopes,
  getEnvelope,
  createEnvelope,
  updateEnvelope,
  addAudit,
  deleteEnvelope,
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const isProd = process.env.NODE_ENV === "production";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF uploads are supported"));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 25 * 1024 * 1024 },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "attest", storage: "local" });
});

app.get("/api/envelopes", (_req, res) => {
  res.json(listEnvelopes());
});

app.get("/api/envelopes/:id", (req, res) => {
  const env = getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Not found" });
  res.json(env);
});

app.post("/api/envelopes", upload.single("document"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "PDF required" });
    let signers = [];
    if (req.body.signers) {
      signers =
        typeof req.body.signers === "string"
          ? JSON.parse(req.body.signers)
          : req.body.signers;
    }
    const envelope = createEnvelope({
      title: req.body.title || req.file.originalname,
      fileName: req.file.originalname,
      storedName: req.file.filename,
      signers,
    });
    res.status(201).json(envelope);
  } catch (err) {
    res.status(400).json({ error: err.message || "Create failed" });
  }
});

app.patch("/api/envelopes/:id", (req, res) => {
  const env = getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Not found" });
  const allowed = ["title", "status", "fields", "signers"];
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }
  const updated = updateEnvelope(req.params.id, patch);
  if (req.body.fields) {
    addAudit(req.params.id, "fields_updated", "Signature fields updated");
  }
  if (req.body.status === "sent" && env.status !== "sent") {
    addAudit(req.params.id, "sent", "Envelope sent for signature");
  }
  res.json(getEnvelope(req.params.id) || updated);
});

app.delete("/api/envelopes/:id", (req, res) => {
  if (!deleteEnvelope(req.params.id)) {
    return res.status(404).json({ error: "Not found" });
  }
  res.status(204).end();
});

app.get("/api/envelopes/:id/document", (req, res) => {
  const env = getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Not found" });
  const preferSigned = req.query.signed === "1" && env.signedStoredName;
  const name = preferSigned ? env.signedStoredName : env.storedName;
  const dir = preferSigned ? SIGNED_DIR : UPLOADS_DIR;
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File missing" });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${preferSigned ? `signed-${env.fileName}` : env.fileName}"`
  );
  fs.createReadStream(filePath).pipe(res);
});

app.post("/api/envelopes/:id/sign", async (req, res) => {
  try {
    const env = getEnvelope(req.params.id);
    if (!env) return res.status(404).json({ error: "Not found" });
    const { signerId, signatureDataUrl, typedName } = req.body || {};
    const signer = env.signers.find((s) => s.id === signerId);
    if (!signer) return res.status(400).json({ error: "Unknown signer" });
    if (!signatureDataUrl) {
      return res.status(400).json({ error: "Signature image required" });
    }

    const sourcePath = path.join(UPLOADS_DIR, env.storedName);
    const pdfBytes = fs.readFileSync(sourcePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pngBase64 = String(signatureDataUrl).replace(
      /^data:image\/\w+;base64,/,
      ""
    );
    const pngBytes = Buffer.from(pngBase64, "base64");
    const signatureImage = await pdfDoc.embedPng(pngBytes);

    const signerFields = (env.fields || []).filter(
      (f) => f.signerId === signerId || !f.signerId
    );
    const targets =
      signerFields.length > 0
        ? signerFields
        : [
            {
              page: 0,
              xPct: 0.12,
              yPct: 0.78,
              wPct: 0.28,
              hPct: 0.08,
              type: "signature",
            },
          ];

    for (const field of targets) {
      const pageIndex = Math.min(
        Math.max(Number(field.page) || 0, 0),
        pages.length - 1
      );
      const page = pages[pageIndex];
      const { width, height } = page.getSize();
      const w = (field.wPct ?? 0.28) * width;
      const h = (field.hPct ?? 0.08) * height;
      const x = (field.xPct ?? 0.12) * width;
      const yFromTop = (field.yPct ?? 0.78) * height;
      const y = height - yFromTop - h;

      if (field.type === "date") {
        const label = new Date().toLocaleDateString();
        page.drawText(label, {
          x: x + 4,
          y: y + h / 3,
          size: 11,
          font,
          color: rgb(0.1, 0.12, 0.16),
        });
      } else if (field.type === "name") {
        page.drawText(typedName || signer.name, {
          x: x + 4,
          y: y + h / 3,
          size: 12,
          font,
          color: rgb(0.1, 0.12, 0.16),
        });
      } else {
        page.drawImage(signatureImage, { x, y, width: w, height: h });
      }
    }

    const outName = `${env.id}-signed.pdf`;
    const outPath = path.join(SIGNED_DIR, outName);
    fs.writeFileSync(outPath, await pdfDoc.save());

    const now = new Date().toISOString();
    const signers = env.signers.map((s) =>
      s.id === signerId
        ? {
            ...s,
            status: "signed",
            signedAt: now,
            signatureDataUrl,
            typedName: typedName || s.name,
          }
        : s
    );
    const allSigned = signers.every((s) => s.status === "signed");
    updateEnvelope(env.id, {
      signers,
      status: allSigned ? "completed" : "partial",
      completedAt: allSigned ? now : null,
      signedStoredName: outName,
    });
    addAudit(
      env.id,
      "signed",
      `${signer.name} signed locally${typedName ? ` as “${typedName}”` : ""}`
    );

    res.json(getEnvelope(env.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Sign failed" });
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
  console.log(`Attest API listening on http://localhost:${PORT}`);
});
