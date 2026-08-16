import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import ConfirmDialog from "../ConfirmDialog.jsx";

const emptyForm = {
  slug: "",
  display_name: "",
  legal_name: "",
  company_number: "",
  vat_number: "",
  registered_office: "",
  sending_domain: "",
  from_address: "",
  reply_to: "",
  domain_verified: true,
  intro_email_text: "",
  email_signature_html: "",
  email_signature_text: "",
  brand: { primary: "#0074ff", secondary: "#101828", font: "Manrope" },
};

export default function CompanySetup() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadKind, setUploadKind] = useState("front_cover");
  const [copied, setCopied] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  async function load() {
    if (isNew) return;
    const data = await api.getEntity(id);
    setDetail(data);
    setForm({
      slug: data.slug,
      display_name: data.display_name,
      legal_name: data.legal_name,
      company_number: data.company_number,
      vat_number: data.vat_number || "",
      registered_office: data.registered_office,
      sending_domain: data.sending_domain,
      from_address: data.from_address,
      reply_to: data.reply_to || "",
      domain_verified: Boolean(data.domain_verified),
      intro_email_text: data.intro_email_text || "",
      email_signature_html: data.email_signature_html,
      email_signature_text: data.email_signature_text,
      brand: data.brand || emptyForm.brand,
    });
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [id]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isNew) {
        const created = await api.createEntity(form);
        navigate(`/companies/${created.id}`);
      } else {
        await api.updateEntity(id, form);
        await load();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(file, kind = uploadKind) {
    if (!file || isNew) return;
    setBusy(true);
    setError("");
    try {
      await api.uploadEntityAsset(id, kind, file, `${form.display_name} ${kind}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyIntro() {
    const text = form.intro_email_text || "";
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy. Select the text and copy it manually.");
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setError("");
    try {
      await api.deleteEntity(id);
      navigate("/companies");
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setPendingDelete(false);
    }
  }

  const signature = detail?.signature_asset;

  return (
    <div>
      <section className="hero-panel">
        <h1>{isNew ? "Add company" : form.display_name || "Company setup"}</h1>
        <p>
          Legal profile and brand pack live here. Contract creation picks a company
          from this list; covers and logo apply automatically.
        </p>
      </section>

      <div className="toolbar">
        <Link className="btn secondary" to="/companies">
          All companies
        </Link>
        {!isNew ? (
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => setPendingDelete(true)}
          >
            Delete company
          </button>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      <form className="panel form-grid" onSubmit={save}>
        {isNew ? (
          <label>
            Slug
            <input
              value={form.slug}
              onChange={(e) => setField("slug", e.target.value)}
              required
              placeholder="acme"
            />
          </label>
        ) : (
          <p className="meta">Slug: {form.slug}</p>
        )}
        <label>
          Display name
          <input
            value={form.display_name}
            onChange={(e) => setField("display_name", e.target.value)}
            required
          />
        </label>
        <label>
          Legal name
          <input
            value={form.legal_name}
            onChange={(e) => setField("legal_name", e.target.value)}
            required
          />
        </label>
        <label>
          Company number
          <input
            value={form.company_number}
            onChange={(e) => setField("company_number", e.target.value)}
            required
          />
        </label>
        <label>
          VAT number
          <input
            value={form.vat_number}
            onChange={(e) => setField("vat_number", e.target.value)}
          />
        </label>
        <label>
          Registered office
          <input
            value={form.registered_office}
            onChange={(e) => setField("registered_office", e.target.value)}
            required
          />
        </label>
        <label>
          Sending domain
          <input
            value={form.sending_domain}
            onChange={(e) => setField("sending_domain", e.target.value)}
            required
          />
        </label>
        <label>
          From address
          <input
            value={form.from_address}
            onChange={(e) => setField("from_address", e.target.value)}
            required
          />
        </label>
        <label className="consent">
          <input
            type="checkbox"
            checked={form.domain_verified}
            onChange={(e) => setField("domain_verified", e.target.checked)}
          />
          <span>Domain verified (required before this company can send contracts)</span>
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : isNew ? "Create company" : "Save company details"}
        </button>
      </form>

      <section className="panel form-grid" style={{ marginTop: "1rem" }}>
        <h2>Introductory email</h2>
        <p className="muted">
          Paste the contract introduction you use in Gmail. Save it here, then copy
          it when you need the same wording. It is stored on this machine only.
        </p>
        <label>
          Intro text
          <textarea
            rows={10}
            value={form.intro_email_text}
            onChange={(e) => setField("intro_email_text", e.target.value)}
            placeholder="Paste the introductory email from Gmail…"
          />
        </label>
        <div className="toolbar">
          <button type="button" className="btn secondary" onClick={copyIntro} disabled={!form.intro_email_text.trim()}>
            {copied ? "Copied" : "Copy intro email"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save intro email"}
          </button>
        </div>
      </section>

      {!isNew ? (
        <section className="panel form-grid" style={{ marginTop: "1rem" }}>
          <h2>Gmail signature file</h2>
          <p className="muted">
            Upload the same signature image attached in Gmail (PNG or JPG) from this
            PC. It is saved in local Attest files — not pulled from Google or a
            company mail server.
          </p>
          {signature ? (
            <div className="signature-preview">
              <img
                src={api.entityAssetUrl(id, signature.id)}
                alt={signature.name || "Email signature"}
              />
              <span className="meta">{signature.name}</span>
            </div>
          ) : (
            <p className="muted">No signature file uploaded yet.</p>
          )}
          <label>
            Signature image
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.gif,.webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                onUpload(file, "email_header");
              }}
            />
          </label>
        </section>
      ) : (
        <p className="muted" style={{ marginTop: "1rem" }}>
          Create the company first, then you can upload its Gmail signature file.
        </p>
      )}

      {!isNew ? (
        <section className="panel form-grid" style={{ marginTop: "1rem" }}>
          <h2>Brand pack (auto-applied)</h2>
          <ul className="audit-list">
            <li>
              <strong>Front cover</strong>
              <span>{detail?.active_pack?.front?.name || "Not set"}</span>
            </li>
            <li>
              <strong>Back cover</strong>
              <span>{detail?.active_pack?.back?.name || "Not set"}</span>
            </li>
            <li>
              <strong>Logo</strong>
              <span>{detail?.active_pack?.logo?.name || "Not set"}</span>
            </li>
          </ul>
          <label>
            Upload asset kind
            <select value={uploadKind} onChange={(e) => setUploadKind(e.target.value)}>
              <option value="front_cover">Front cover</option>
              <option value="back_cover">Back cover</option>
              <option value="logo">Logo</option>
            </select>
          </label>
          <label>
            File
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => onUpload(e.target.files?.[0])}
            />
          </label>
          <p className="muted">
            Uploading replaces the active asset of that kind for this company.
          </p>
          <h3>Asset library</h3>
          <ul className="audit-list">
            {(detail?.assets || []).map((asset) => (
              <li key={asset.id}>
                <strong>
                  {asset.kind === "email_header" ? "gmail_signature" : asset.kind}
                  {asset.is_active ? " · active" : ""}
                </strong>
                <span>{asset.name}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Are you sure?"
          message={`Delete ${form.display_name || "this company"}? It will leave the catalog. Existing contracts stay on file.`}
          confirmLabel="Yes, delete company"
          busy={busy}
          onCancel={() => (busy ? null : setPendingDelete(false))}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}
