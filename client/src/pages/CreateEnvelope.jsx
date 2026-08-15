import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

const blankSigner = () => ({ name: "", email: "" });

export default function CreateEnvelope() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [signers, setSigners] = useState([blankSigner()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateSigner(index, key, value) {
    setSigners((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (!file) {
      setError("Choose a PDF to upload.");
      return;
    }
    const cleaned = signers
      .map((s) => ({
        name: s.name.trim(),
        email: s.email.trim(),
      }))
      .filter((s) => s.name || s.email);
    if (cleaned.length === 0) {
      setError("Add at least one signer name.");
      return;
    }

    const body = new FormData();
    body.append("document", file);
    body.append("title", title.trim() || file.name);
    body.append("signers", JSON.stringify(cleaned));

    setBusy(true);
    try {
      const envelope = await api.createEnvelope(body);
      navigate(`/envelopes/${envelope.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="hero-panel">
        <h1>New envelope</h1>
        <p>Upload a PDF, name the signers, then place fields and send locally.</p>
      </section>

      <form className="panel form-grid" onSubmit={onSubmit}>
        <label>
          Document title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Offer letter, NDA, intake form…"
          />
        </label>

        <label>
          PDF file
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>

        <div className="form-grid">
          <strong>Signers</strong>
          {signers.map((signer, index) => (
            <div className="signer-row" key={index}>
              <label>
                Name
                <input
                  type="text"
                  value={signer.name}
                  onChange={(e) => updateSigner(index, "name", e.target.value)}
                  required={index === 0}
                />
              </label>
              <label>
                Email (optional)
                <input
                  type="email"
                  value={signer.email}
                  onChange={(e) => updateSigner(index, "email", e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn secondary"
                disabled={signers.length === 1}
                onClick={() =>
                  setSigners((rows) => rows.filter((_, i) => i !== index))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn secondary"
            onClick={() => setSigners((rows) => [...rows, blankSigner()])}
          >
            Add signer
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="toolbar" style={{ margin: 0 }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create envelope"}
          </button>
        </div>
      </form>
    </div>
  );
}
