import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

const blankParty = (roleKey) => ({
  roleKey,
  company_name: "",
  signer_name: "",
  signer_email: "",
});

export default function CreateEnvelope() {
  const navigate = useNavigate();
  const [bootstrap, setBootstrap] = useState(null);
  const [entityId, setEntityId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [parties, setParties] = useState([
    blankParty("company"),
    blankParty("agency"),
    blankParty("supplier"),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.bootstrap().then((data) => {
      setBootstrap(data);
      setEntityId(data.entities[0]?.id || "");
      setTemplateId(data.templates[0]?.id || "");
      setTitle(data.templates[0]?.name || "");
    });
  }, []);

  function updateParty(roleKey, key, value) {
    setParties((rows) =>
      rows.map((row) => (row.roleKey === roleKey ? { ...row, [key]: value } : row))
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const envelope = await api.createEnvelope({
        entityId,
        templateId,
        title,
        parties,
      });
      navigate(`/envelopes/${envelope.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!bootstrap) return <p className="muted">Loading…</p>;

  return (
    <div>
      <section className="hero-panel">
        <h1>New envelope</h1>
        <p>Assign company, agency, and supplier parties, then bake before sending.</p>
      </section>
      <form className="panel form-grid" onSubmit={onSubmit}>
        <label>
          Entity
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {bootstrap.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.display_name} {e.domain_verified ? "" : "(unverified)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Template
          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const t = bootstrap.templates.find((x) => x.id === e.target.value);
              if (t) setTitle(t.name);
            }}
          >
            {bootstrap.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>

        {parties.map((party) => (
          <div className="party-card" key={party.roleKey}>
            <h3>{party.roleKey}</h3>
            <div className="signer-row">
              <label>
                Company
                <input
                  value={party.company_name}
                  onChange={(e) =>
                    updateParty(party.roleKey, "company_name", e.target.value)
                  }
                  required
                />
              </label>
              <label>
                Signer
                <input
                  value={party.signer_name}
                  onChange={(e) =>
                    updateParty(party.roleKey, "signer_name", e.target.value)
                  }
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={party.signer_email}
                  onChange={(e) =>
                    updateParty(party.roleKey, "signer_email", e.target.value)
                  }
                  required
                />
              </label>
            </div>
          </div>
        ))}

        {error ? <p className="error">{error}</p> : null}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create draft envelope"}
        </button>
      </form>
    </div>
  );
}
