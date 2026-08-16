import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import ConfirmDialog from "../ConfirmDialog.jsx";

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [pending, setPending] = useState(null);

  function load() {
    return api
      .listEntities()
      .then(setCompanies)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function confirmDelete() {
    if (!pending) return;
    setBusyId(pending.id);
    setError("");
    try {
      await api.deleteEntity(pending.id);
      setPending(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      <section className="hero-panel">
        <h1>Companies</h1>
        <p>
          Sending companies hold legal details and brand packs (covers + logo).
          Choosing a company on a new contract auto-applies that pack.
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
          <div
            key={company.id}
            className="envelope-row"
            style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}
          >
            <Link to={`/companies/${company.id}`} className="envelope-row-main">
              <h3>{company.display_name}</h3>
              <div className="meta">
                {company.legal_name} · {company.company_number} · {company.from_address}
              </div>
            </Link>
            <div className="envelope-row-actions">
              <span className={`badge ${company.domain_verified ? "completed" : "draft"}`}>
                {company.domain_verified ? "verified" : "unverified"}
              </span>
              <button
                type="button"
                className="btn danger"
                disabled={Boolean(busyId)}
                onClick={() => setPending(company)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {pending ? (
        <ConfirmDialog
          title="Are you sure?"
          message={`Delete ${pending.display_name}? It will leave the company catalog. Existing contracts stay on file.`}
          confirmLabel="Yes, delete company"
          busy={busyId === pending.id}
          onCancel={() => (busyId ? null : setPending(null))}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}
