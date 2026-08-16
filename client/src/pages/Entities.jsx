import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Entities() {
  const [bootstrap, setBootstrap] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .bootstrap()
      .then(setBootstrap)
      .catch((err) => setError(err.message));
  }, []);

  if (!bootstrap && !error) return <p className="muted">Loading…</p>;

  return (
    <div>
      <section className="hero-panel">
        <h1>Entities</h1>
        <p>
          Legal party profile is the single source of truth for branding. Active
          covers and logo are applied automatically at bake.
        </p>
      </section>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid">
        {(bootstrap?.entities || []).map((entity) => {
          const assets = (bootstrap.assets || []).filter((a) => a.entity_id === entity.id);
          return (
            <section className="panel" key={entity.id}>
              <h2>{entity.display_name}</h2>
              <p className="meta">{entity.legal_name}</p>
              <p className="meta">
                {entity.company_number} · VAT {entity.vat_number || "—"}
              </p>
              <p className="meta">{entity.registered_office}</p>
              <p className="meta">
                From {entity.from_address} · domain {entity.sending_domain}{" "}
                <span className={`badge ${entity.domain_verified ? "completed" : "draft"}`}>
                  {entity.domain_verified ? "verified" : "unverified"}
                </span>
              </p>
              <h3>Brand assets</h3>
              <ul className="audit-list">
                {assets.map((asset) => (
                  <li key={asset.id}>
                    <strong>{asset.kind}</strong>
                    <span>{asset.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
