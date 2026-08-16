import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listTemplates()
      .then(setTemplates)
      .catch((err) => setError(err.message));
  }, []);

  async function openTemplate(id) {
    try {
      setSelected(await api.getTemplate(id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <section className="hero-panel">
        <h1>Templates</h1>
        <p>
          Roles, field ownership, and evidence requirements live on the template so
          envelope creation stays consistent.
        </p>
      </section>
      {error ? <p className="error">{error}</p> : null}
      <div className="split">
        <div className="envelope-list">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="envelope-row"
              onClick={() => openTemplate(t.id)}
            >
              <div>
                <h3>{t.name}</h3>
                <div className="meta">
                  {t.industry || "general"} · {t.description || t.source_url}
                </div>
              </div>
              <span className="badge draft">{t.roles?.length || 0} roles</span>
            </button>
          ))}
        </div>
        <div className="panel">
          {!selected ? (
            <p className="muted">Select a template</p>
          ) : (
            <>
              <h2>{selected.name}</h2>
              <p className="meta">{selected.source_url}</p>
              <h3>Roles</h3>
              {selected.roles.map((role) => (
                <div key={role.id} className="role-block">
                  <strong>
                    {role.label} ({role.role_key}) · order {role.signing_order}
                  </strong>
                  {role.evidence_required ? (
                    <ul>
                      {role.evidence_requirements.map((req) => (
                        <li key={req.id}>
                          {req.label} · {req.verify_method}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No evidence gate</p>
                  )}
                </div>
              ))}
              <h3>Fields</h3>
              <ul>
                {selected.fields.map((f) => (
                  <li key={f.id}>
                    {f.label} · {f.field_type} · page {f.page}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
