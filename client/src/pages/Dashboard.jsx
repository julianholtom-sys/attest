import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

function formatWhen(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function Dashboard() {
  const [envelopes, setEnvelopes] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.listEnvelopes();
        if (alive) setEnvelopes(data);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <section className="hero-panel">
        <h1>Sign documents without leaving your machine.</h1>
        <p>
          Attest keeps PDFs, signatures, and audit trails on local disk — no
          Google Drive, no GCS, no third-party signing cloud.
        </p>
      </section>

      <div className="toolbar">
        <Link className="btn" to="/new">
          Start an envelope
        </Link>
        <span className="muted">Storage: ./server/data</span>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading envelopes…</p> : null}

      {!loading && envelopes.length === 0 ? (
        <div className="empty">
          No envelopes yet. Upload a PDF to create your first local signing
          packet.
        </div>
      ) : (
        <div className="envelope-list">
          {envelopes.map((env, i) => (
            <Link
              key={env.id}
              to={`/envelopes/${env.id}`}
              className="envelope-row"
              style={{ animationDelay: `${Math.min(i, 8) * 0.05}s` }}
            >
              <div>
                <h3>{env.title}</h3>
                <div className="meta">
                  {env.fileName} · updated {formatWhen(env.updatedAt)} ·{" "}
                  {env.signers?.length || 0} signer
                  {(env.signers?.length || 0) === 1 ? "" : "s"}
                </div>
              </div>
              <span className={`badge ${env.status}`}>{env.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
