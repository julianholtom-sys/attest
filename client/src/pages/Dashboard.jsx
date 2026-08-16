import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

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
        <h1>Contracts</h1>
        <p>
          Sent from Union Payroll. Every contract includes the master agreement,
          company brand covers, and any industry appendices selected at create time.
        </p>
      </section>

      <div className="toolbar">
        <Link className="btn" to="/new">
          Create contract
        </Link>
        <span className="muted">Storage: server/data · DB: attest.sqlite</span>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && envelopes.length === 0 ? (
        <div className="empty">No contracts yet. Create one from the master template.</div>
      ) : (
        <div className="envelope-list">
          {envelopes.map((env, i) => (
            <Link
              key={env.id}
              to={`/envelopes/${env.id}`}
              className="envelope-row"
              style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}
            >
              <div>
                <h3>{env.title || "Untitled"}</h3>
                <div className="meta">
                  {env.entity?.display_name || "Entity"} · {env.party_count} parties ·{" "}
                  {new Date(env.created_at).toLocaleString()}
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
