import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";

export default function EnvelopeDetail() {
  const { id } = useParams();
  const [envelope, setEnvelope] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [links, setLinks] = useState({});
  const [chain, setChain] = useState(null);

  async function reload() {
    const data = await api.getEnvelope(id);
    setEnvelope(data);
    setChain(await api.verifyEvents(id));
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [id]);

  async function run(action, fn) {
    setBusy(action);
    setError("");
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (!envelope && !error) return <p className="muted">Loading envelope…</p>;
  if (!envelope) return <p className="error">{error}</p>;

  return (
    <div>
      <section className="hero-panel">
        <h1>{envelope.title}</h1>
        <p>
          {envelope.entity?.display_name} ·{" "}
          <span className={`badge ${envelope.status}`}>{envelope.status}</span>
          {envelope.industry ? <span className="muted"> · {envelope.industry}</span> : null}
          {envelope.baked_hash ? (
            <span className="muted"> · bake {envelope.baked_hash.slice(0, 12)}…</span>
          ) : null}
        </p>
        <p className="meta">
          Prepared {envelope.prepared_on || "—"} · Issued{" "}
          {envelope.issued_at ? String(envelope.issued_at).slice(0, 10) : "on send"}
        </p>
      </section>

      {envelope.bake_error ? <p className="error">Bake error: {envelope.bake_error}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="toolbar">
        <button
          className="btn"
          type="button"
          disabled={busy || envelope.status !== "draft"}
          onClick={() => run("bake", () => api.bakeEnvelope(id))}
        >
          {busy === "bake" ? "Baking…" : "Bake"}
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={busy || envelope.status !== "ready"}
          onClick={() => run("send", () => api.sendEnvelope(id))}
        >
          {busy === "send" ? "Sending…" : "Send first invitation"}
        </button>
        {envelope.baked_document_id ? (
          <a className="btn secondary" href={api.documentUrl(id, "baked")} target="_blank" rel="noreferrer">
            Open baked PDF
          </a>
        ) : null}
        {envelope.status === "completed" ? (
          <>
            <a className="btn secondary" href={api.documentUrl(id, "completed")} target="_blank" rel="noreferrer">
              Completed PDF
            </a>
            <a className="btn secondary" href={api.documentUrl(id, "certificate")} target="_blank" rel="noreferrer">
              Certificate
            </a>
          </>
        ) : null}
        <button
          className="btn danger"
          type="button"
          disabled={busy || ["completed", "declined", "voided", "expired"].includes(envelope.status)}
          onClick={() =>
            run("void", () => api.voidEnvelope(id, "Voided from staff console"))
          }
        >
          Void
        </button>
      </div>

      <section className="panel" style={{ marginBottom: "1.25rem" }}>
        <h2>Auto-applied pack</h2>
        <ul className="audit-list">
          <li>
            <strong>Front cover</strong>
            <span>{envelope.auto_pack?.front?.name || "—"}</span>
          </li>
          <li>
            <strong>Back cover</strong>
            <span>{envelope.auto_pack?.back?.name || "—"}</span>
          </li>
          <li>
            <strong>Logo</strong>
            <span>{envelope.auto_pack?.logo?.name || "—"}</span>
          </li>
          <li>
            <strong>Appendices</strong>
            <span>
              {(envelope.auto_pack?.appendices || []).map((a) => a.name).join(", ") || "—"}
            </span>
          </li>
        </ul>
      </section>

      <div className="split">
        <section className="panel">
          <h2>Parties</h2>
          <div className="form-grid">
            {envelope.parties.map((party) => (
              <div className="party-card" key={party.id}>
                <div className="toolbar" style={{ margin: 0 }}>
                  <strong>
                    {party.role_label} · {party.signer_name}
                  </strong>
                  <span className={`badge ${party.status}`}>{party.status}</span>
                </div>
                <p className="meta">
                  {party.company_name} · {party.signer_email}
                </p>
                {party.evidence_required ? (
                  <p className="muted">Evidence gate required before sign</p>
                ) : null}
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    run(`link-${party.id}`, async () => {
                      const result = await api.partyLink(id, party.id);
                      setLinks((prev) => ({ ...prev, [party.id]: result.signingLink }));
                    })
                  }
                >
                  Mint / resend link
                </button>
                {links[party.id] ? (
                  <p className="meta">
                    <a href={links[party.id]}>Open signing room</a>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <div className="grid">
          <section className="panel">
            <h2>Audit chain</h2>
            {chain ? (
              <p className={`meta ${chain.ok ? "" : "error"}`}>
                {chain.ok
                  ? `Verified · ${chain.checked} events`
                  : `BROKEN · ${chain.broken.length} issues`}
              </p>
            ) : null}
            <ul className="audit-list">
              {[...(envelope.events || [])].reverse().map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.event_type}</strong>
                  <span className="muted">{new Date(entry.created_at).toLocaleString()}</span>
                  <span className="muted">{entry.actor}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Local email outbox</h2>
            <ul className="audit-list">
              {(envelope.emails || []).map((mail) => (
                <li key={mail.id}>
                  <strong>{mail.template_type}</strong>
                  <span className="muted">{mail.to_address}</span>
                  <span>{mail.subject}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
