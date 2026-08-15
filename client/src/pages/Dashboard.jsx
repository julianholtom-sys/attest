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
        <h1>Three-party envelopes, baked and auditable.</h1>
        <p>
          Local implementation of the Attest data model: entity branding, template
          roles, bake immutability, evidence gates, and a hash-chained event log —
          on disk + SQLite, no GCS.
        </p>
      </section>

      <div className="toolbar">
        <Link className="btn" to="/new">
          Create envelope
        </Link>
        <span className="muted">Storage: server/data · DB: attest.sqlite</span>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && envelopes.length === 0 ? (
        <div className="empty">No envelopes yet. Create one from the seeded MSA template.</div>
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
