import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listEntities()
      .then(setCompanies)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <section className="hero-panel">
        <h1>Companies</h1>
        <p>
          Sending companies hold legal details and brand packs (covers + logo).
          Choosing a company on a new envelope auto-applies that pack.
        </p>
      </section>
      <div className="toolbar">
        <Link className="btn" to="/companies/new">
          Add company
        </Link>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="envelope-list">
        {companies.map((company, i) => (
          <Link
            key={company.id}
            to={`/companies/${company.id}`}
            className="envelope-row"
            style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}
          >
            <div>
              <h3>{company.display_name}</h3>
              <div className="meta">
                {company.legal_name} · {company.company_number} · {company.from_address}
              </div>
            </div>
            <span className={`badge ${company.domain_verified ? "completed" : "draft"}`}>
              {company.domain_verified ? "verified" : "unverified"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
