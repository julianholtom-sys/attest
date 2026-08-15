# Attest

Local e-sign UI framework. Upload PDFs, place signature fields, capture drawn signatures, and keep every file plus audit trail on disk — **no Google / GCS / cloud object storage**.

## Stack

- **client** — Vite + React (PDF.js viewer, signature pad)
- **server** — Express API with `multer` uploads and `pdf-lib` stamping
- **storage** — `server/data/` (`uploads/`, `signed/`, `db.json`)

## Quick start

```bash
npm install
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:8787  

Production:

```bash
npm run build
npm start
```

The Express server serves `client/dist` when `NODE_ENV=production`.

## Flow

1. **New envelope** — upload a PDF and add signers  
2. **Place fields** — signature / date / name chips on the page  
3. **Signing room** — draw a signature and apply it to the local PDF  
4. **Audit trail** — events stored with the envelope record  

## Notes

- Prior agent artifact `attest-local-framework.tar.gz` was unavailable in this environment; this tree is a local Vite/React/Express rebuild without cloud storage.
- Re-attach the original e-sign PDF if the UI should be matched pixel-for-pixel to that design.
