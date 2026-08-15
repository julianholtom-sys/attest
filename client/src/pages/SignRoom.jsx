import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#10242b";
  }, []);

  function point(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  function emit() {
    onChange?.(canvasRef.current.toDataURL("image/png"));
  }

  return (
    <div>
      <div className="sig-pad-wrap">
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => {
            e.preventDefault();
            drawing.current = true;
            last.current = point(e);
          }}
          onMouseMove={(e) => {
            if (!drawing.current) return;
            e.preventDefault();
            const ctx = canvasRef.current.getContext("2d");
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            last.current = p;
            emit();
          }}
          onMouseUp={(e) => {
            drawing.current = false;
            e.preventDefault();
            emit();
          }}
          onMouseLeave={() => {
            drawing.current = false;
          }}
        />
      </div>
      <button
        type="button"
        className="btn secondary"
        onClick={() => {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          onChange?.("");
        }}
      >
        Clear signature
      </button>
    </div>
  );
}

export default function SignRoom() {
  const { token } = useParams();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function reload() {
    setSession(await api.signSession(token));
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [token]);

  async function onUpload(requirementId, file) {
    setError("");
    try {
      const result = await api.uploadEvidence(token, requirementId, file);
      setSession((prev) => ({
        ...prev,
        checklist: result.checklist,
        gate: result.gate,
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveDateFields() {
    const dateFields = (session.fields || []).filter((f) => f.field_type === "date");
    const today = new Date().toISOString().slice(0, 10);
    for (const field of dateFields) {
      await api.saveField(token, field.id, today);
    }
  }

  async function submitSign() {
    setBusy(true);
    setError("");
    try {
      await saveDateFields();
      await api.sign(token, {
        signatureDataUrl,
        method: "drawn",
        consent,
        typedName: session.party.signer_name,
      });
      setDone(true);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !session) return <p className="error">{error}</p>;
  if (!session) return <p className="muted">Validating signing link…</p>;

  const gateOk = session.gate?.ok;

  return (
    <div>
      <section className="hero-panel">
        <h1>
          Sign as {session.party.role_label}: {session.party.signer_name}
        </h1>
        <p>
          {session.envelope.title}. Document hash must match the baked snapshot at
          signature time.
        </p>
      </section>

      {!session.is_turn ? (
        <p className="error">It is not your turn yet (sequential signing).</p>
      ) : null}

      <div className="split">
        <iframe
          title="Baked document"
          className="pdf-frame"
          src={session.document_url}
        />

        <div className="panel form-grid">
          {session.party.role_key === "company" || session.checklist?.length ? (
            <div>
              <h2>Evidence checklist</h2>
              <div className="form-grid">
                {session.checklist.map((item) => (
                  <div className="party-card" key={item.id}>
                    <strong>
                      {item.label}{" "}
                      <span className={`badge ${item.satisfied ? "completed" : "sent"}`}>
                        {item.satisfied ? "satisfied" : "required"}
                      </span>
                    </strong>
                    <p className="muted">{item.description}</p>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUpload(item.id, file);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>{session.consent_text}</span>
          </label>

          <div>
            <div className="muted" style={{ marginBottom: "0.4rem" }}>
              Draw signature
            </div>
            <SignaturePad onChange={setSignatureDataUrl} />
          </div>

          {error ? <p className="error">{error}</p> : null}
          {done ? (
            <p className="meta">Signature captured. Status: {session.envelope.status}</p>
          ) : null}

          <button
            className="btn"
            type="button"
            disabled={busy || !consent || !signatureDataUrl || !session.is_turn || !gateOk}
            onClick={submitSign}
          >
            {busy ? "Signing…" : gateOk ? "Finish & sign" : "Evidence gate locked"}
          </button>
        </div>
      </div>
    </div>
  );
}
