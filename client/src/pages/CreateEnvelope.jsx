import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

const blankParty = (roleKey) => ({
  roleKey,
  company_name: "",
  signer_name: "",
  signer_email: "",
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function CreateEnvelope() {
  const navigate = useNavigate();
  const [bootstrap, setBootstrap] = useState(null);
  const [entityId, setEntityId] = useState("");
  const [industry, setIndustry] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [preparedOn, setPreparedOn] = useState(todayISO());
  const [pack, setPack] = useState(null);
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
      const entity = data.entities[0]?.id || "";
      setEntityId(entity);
      const firstIndustry = data.industries[0] || data.templates[0]?.industry || "";
      setIndustry(firstIndustry);
      const firstTemplate =
        data.templates.find((t) => t.industry === firstIndustry) || data.templates[0];
      setTemplateId(firstTemplate?.id || "");
      setTitle(firstTemplate?.name || "");
    });
  }, []);

  const contracts = useMemo(() => {
    if (!bootstrap) return [];
    return bootstrap.templates.filter((t) => !industry || t.industry === industry);
  }, [bootstrap, industry]);

  useEffect(() => {
    if (!entityId || !templateId) {
      setPack(null);
      return undefined;
    }
    let alive = true;
    api
      .brandPack(entityId, templateId)
      .then((data) => {
        if (alive) setPack(data);
      })
      .catch(() => {
        if (alive) setPack(null);
      });
    return () => {
      alive = false;
    };
  }, [entityId, templateId]);

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
        preparedOn,
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
        <p>
          Pick industry and contract. Covers, logo, and industry appendices apply
          automatically from the sending company brand pack.
        </p>
      </section>
      <form className="panel form-grid" onSubmit={onSubmit}>
        <label>
          Sending entity
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {bootstrap.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.display_name} {e.domain_verified ? "" : "(unverified)"}
              </option>
            ))}
          </select>
        </label>

        <label>
          Industry
          <select
            value={industry}
            onChange={(e) => {
              const next = e.target.value;
              setIndustry(next);
              const first = bootstrap.templates.find((t) => t.industry === next);
              if (first) {
                setTemplateId(first.id);
                setTitle(first.name);
              }
            }}
          >
            {bootstrap.industries.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          Contract
          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const t = bootstrap.templates.find((x) => x.id === e.target.value);
              if (t) setTitle(t.name);
            }}
          >
            {contracts.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Envelope title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>

        <label>
          Date contract originally prepared
          <input
            type="date"
            value={preparedOn}
            onChange={(e) => setPreparedOn(e.target.value)}
            required
          />
        </label>

        <p className="muted">
          Issued date is set automatically to the day the envelope is sent.
        </p>

        <section className="party-card">
          <h3>Auto brand pack</h3>
          {!pack ? (
            <p className="muted">Resolving covers and appendices…</p>
          ) : (
            <ul className="audit-list">
              <li>
                <strong>Industry</strong>
                <span>{pack.industry || "—"}</span>
              </li>
              <li>
                <strong>Front cover</strong>
                <span>{pack.front?.name || "None configured"}</span>
              </li>
              <li>
                <strong>Back cover</strong>
                <span>{pack.back?.name || "None configured"}</span>
              </li>
              <li>
                <strong>Logo</strong>
                <span>{pack.logo?.name || "None configured"}</span>
              </li>
              <li>
                <strong>Appendices</strong>
                <span>
                  {pack.appendices?.length
                    ? pack.appendices.map((a) => a.name).join(", ")
                    : "None for this industry"}
                </span>
              </li>
            </ul>
          )}
        </section>

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
        <button className="btn" type="submit" disabled={busy || !templateId}>
          {busy ? "Creating…" : "Create draft envelope"}
        </button>
      </form>
    </div>
  );
}
