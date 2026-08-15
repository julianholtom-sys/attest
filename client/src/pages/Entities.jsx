import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Entities() {
  const [entities, setEntities] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listEntities()
      .then(setEntities)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <section className="hero-panel">
        <h1>Entities</h1>
        <p>
          Legal party profile is the single source of truth for branding and contract
          stamps. Unverified sending domains cannot create envelopes.
        </p>
      </section>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid">
        {entities.map((entity) => (
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
            <p className="muted">
              Brand primary {entity.brand?.primary || "—"} · font{" "}
              {entity.brand?.font || "—"}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
