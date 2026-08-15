import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import PdfViewer from "../components/PdfViewer.jsx";
import SignaturePad from "../components/SignaturePad.jsx";

export default function SignPage() {
  const { id } = useParams();
  const [envelope, setEnvelope] = useState(null);
  const [signerId, setSignerId] = useState("");
  const [typedName, setTypedName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.getEnvelope(id);
        if (!alive) return;
        setEnvelope(data);
        const firstPending =
          data.signers.find((s) => s.status !== "signed") || data.signers[0];
        setSignerId(firstPending?.id || "");
        setTypedName(firstPending?.name || "");
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  async function submit() {
    setError("");
    if (!signerId) {
      setError("Choose a signer.");
      return;
    }
    if (!signatureDataUrl) {
      setError("Draw a signature before finishing.");
      return;
    }
    setBusy(true);
    try {
      const updated = await api.sign(id, {
        signerId,
        signatureDataUrl,
        typedName,
      });
      setEnvelope(updated);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !envelope) return <p className="error">{error}</p>;
  if (!envelope) return <p className="muted">Preparing signing room…</p>;

  return (
    <div>
      <section className="hero-panel">
        <h1>Sign “{envelope.title}”</h1>
        <p>
          Affirm intent, draw your signature, and Attest will stamp it onto the
          local PDF with an audit entry.
        </p>
      </section>

      {done ? (
        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <h2>Signature captured</h2>
          <p className="muted">
            Status is now <strong>{envelope.status}</strong>. A signed copy is
            stored under <code>server/data/signed</code>.
          </p>
          <div className="toolbar">
            <Link className="btn" to={`/envelopes/${id}`}>
              Back to envelope
            </Link>
            <a
              className="btn secondary"
              href={api.documentUrl(id, true)}
              target="_blank"
              rel="noreferrer"
            >
              View signed PDF
            </a>
          </div>
        </div>
      ) : null}

      <div className="split">
        <PdfViewer url={api.documentUrl(id)} fields={envelope.fields || []} />

        <div className="panel form-grid">
          <label>
            Signing as
            <select
              value={signerId}
              onChange={(e) => {
                const next = e.target.value;
                setSignerId(next);
                const signer = envelope.signers.find((s) => s.id === next);
                setTypedName(signer?.name || "");
              }}
              style={{
                width: "100%",
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: "0.7rem 0.85rem",
                background: "rgba(255,255,255,0.85)",
              }}
            >
              {envelope.signers.map((signer) => (
                <option key={signer.id} value={signer.id}>
                  {signer.name} ({signer.status})
                </option>
              ))}
            </select>
          </label>

          <label>
            Typed name
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
            />
          </label>

          <div>
            <div className="muted" style={{ marginBottom: "0.4rem" }}>
              Draw signature
            </div>
            <SignaturePad onChange={setSignatureDataUrl} />
          </div>

          {error ? <p className="error">{error}</p> : null}

          <button className="btn" type="button" onClick={submit} disabled={busy || done}>
            {busy ? "Applying…" : "Finish & apply signature"}
          </button>
        </div>
      </div>
    </div>
  );
}
