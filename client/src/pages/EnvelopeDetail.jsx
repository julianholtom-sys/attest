import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import PdfViewer from "../components/PdfViewer.jsx";

export default function EnvelopeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [envelope, setEnvelope] = useState(null);
  const [fields, setFields] = useState([]);
  const [placeMode, setPlaceMode] = useState(null);
  const [activeSignerId, setActiveSignerId] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.getEnvelope(id);
        if (!alive) return;
        setEnvelope(data);
        setFields(data.fields || []);
        setActiveSignerId(data.signers?.[0]?.id || null);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  async function saveFields(nextFields = fields) {
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateEnvelope(id, { fields: nextFields });
      setEnvelope(updated);
      setFields(updated.fields || nextFields);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendEnvelope() {
    setSaving(true);
    setError("");
    try {
      await api.updateEnvelope(id, { fields, status: "sent" });
      const updated = await api.getEnvelope(id);
      setEnvelope(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this envelope and its local files?")) return;
    await api.deleteEnvelope(id);
    navigate("/");
  }

  if (error && !envelope) return <p className="error">{error}</p>;
  if (!envelope) return <p className="muted">Loading envelope…</p>;

  const docUrl = api.documentUrl(
    id,
    envelope.status === "completed" && Boolean(envelope.signedStoredName)
  );

  return (
    <div>
      <section className="hero-panel">
        <h1>{envelope.title}</h1>
        <p>
          {envelope.fileName} · <span className={`badge ${envelope.status}`}>{envelope.status}</span>
        </p>
      </section>

      <div className="toolbar">
        <Link className="btn" to={`/envelopes/${id}/sign`}>
          Open signing room
        </Link>
        <button className="btn secondary" type="button" onClick={sendEnvelope} disabled={saving}>
          Mark sent
        </button>
        <a className="btn secondary" href={docUrl} target="_blank" rel="noreferrer">
          Open PDF
        </a>
        <button className="btn danger" type="button" onClick={remove}>
          Delete
        </button>
      </div>

      <div className="split">
        <div>
          <div className="toolbar">
            <button
              type="button"
              className={`btn ${placeMode === "signature" ? "" : "secondary"}`}
              onClick={() =>
                setPlaceMode((m) => (m === "signature" ? null : "signature"))
              }
            >
              Place signature
            </button>
            <button
              type="button"
              className={`btn ${placeMode === "date" ? "" : "secondary"}`}
              onClick={() => setPlaceMode((m) => (m === "date" ? null : "date"))}
            >
              Place date
            </button>
            <button
              type="button"
              className={`btn ${placeMode === "name" ? "" : "secondary"}`}
              onClick={() => setPlaceMode((m) => (m === "name" ? null : "name"))}
            >
              Place name
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => saveFields()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save fields"}
            </button>
          </div>
          <p className="muted">
            Click the page to drop a field. Double-click a field to remove it.
          </p>
          <PdfViewer
            url={docUrl}
            fields={fields}
            onFieldsChange={(next) => {
              setFields(next);
            }}
            placeMode={placeMode}
            activeSignerId={activeSignerId}
          />
        </div>

        <div className="grid">
          <section className="panel">
            <h2>Signers</h2>
            <div className="form-grid">
              {envelope.signers.map((signer) => (
                <button
                  key={signer.id}
                  type="button"
                  className={`btn ${activeSignerId === signer.id ? "" : "secondary"}`}
                  onClick={() => setActiveSignerId(signer.id)}
                >
                  {signer.name || "Signer"} · {signer.status}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Audit trail</h2>
            <ul className="audit-list">
              {[...(envelope.audit || [])].reverse().map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.action}</strong>
                  <span className="muted">{new Date(entry.at).toLocaleString()}</span>
                  <span>{entry.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
