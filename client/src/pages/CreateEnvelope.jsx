import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  const [appendixIds, setAppendixIds] = useState([]);
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
      const firstIndustry = data.industries[0] || "";
      setIndustry(firstIndustry);
      setTitle(data.masterTemplate?.name || "Master Services Agreement");
    });
  }, []);

  const industryAppendices = useMemo(() => {
    if (!bootstrap || !industry) return [];
    return bootstrap.appendices.filter((a) => a.industry === industry);
  }, [bootstrap, industry]);

  useEffect(() => {
    setAppendixIds((prev) =>
      prev.filter((id) => industryAppendices.some((a) => a.id === id))
    );
  }, [industryAppendices]);

  useEffect(() => {
    if (!entityId) {
      setPack(null);
      return undefined;
    }
    let alive = true;
    api
      .brandPack(entityId, { industry, appendixIds })
      .then((data) => {
        if (alive) setPack(data);
      })
      .catch(() => {
        if (alive) setPack(null);
      });
    return () => {
      alive = false;
    };
  }, [entityId, industry, appendixIds]);

  function toggleAppendix(id) {
    setAppendixIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

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
        title,
        preparedOn,
        industry,
        appendixIds,
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

  const master = bootstrap.masterTemplate;

  return (
    <div>
      <section className="hero-panel">
        <h1>New contract</h1>
        <p>
          The master contract is always included. Choose a sending company, then add
          any industry appendices needed for this deal.
        </p>
      </section>
      <form className="panel form-grid" onSubmit={onSubmit}>
        <label>
          Sending company
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)} required>
            <option value="" disabled>
              Select a company…
            </option>
            {bootstrap.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.display_name} — {e.legal_name}
                {e.domain_verified ? "" : " (unverified)"}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Brand covers and logo come from that company’s setup.{" "}
          {entityId ? (
            <Link to={`/companies/${entityId}`}>Open company setup</Link>
          ) : (
            <Link to="/companies">Manage companies</Link>
          )}
        </p>

        <section className="party-card">
          <h3>Master contract (always sent)</h3>
          {master ? (
            <ul className="audit-list">
              <li>
                <strong>{master.name}</strong>
                <span>{master.description || "Core agreement"}</span>
              </li>
            </ul>
          ) : (
            <p className="error">
              No master contract configured.{" "}
              <Link to="/templates">Upload one in Templates</Link>.
            </p>
          )}
        </section>

        <label>
          Industry (for appendix choices)
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          >
            <option value="">No industry appendices</option>
            {bootstrap.industries.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <section className="party-card">
          <h3>Optional industry appendices</h3>
          {!industry ? (
            <p className="muted">Pick an industry to see available appendices.</p>
          ) : industryAppendices.length === 0 ? (
            <p className="muted">
              No appendices for {industry}.{" "}
              <Link to="/templates">Add one in Templates</Link>.
            </p>
          ) : (
            <div className="stack">
              {industryAppendices.map((a) => (
                <label className="consent" key={a.id}>
                  <input
                    type="checkbox"
                    checked={appendixIds.includes(a.id)}
                    onChange={() => toggleAppendix(a.id)}
                  />
                  <span>
                    {a.name}
                    {a.description ? ` — ${a.description}` : ""}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <label>
          Contract title
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
          Issued date is set automatically to the day the contract is sent.
        </p>

        <section className="party-card">
          <h3>Pack preview</h3>
          {!pack ? (
            <p className="muted">Resolving covers…</p>
          ) : (
            <ul className="audit-list">
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
                <strong>Selected appendices</strong>
                <span>
                  {pack.appendices?.length
                    ? pack.appendices.map((a) => a.name).join(", ")
                    : "None selected"}
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
        <button className="btn" type="submit" disabled={busy || !master}>
          {busy ? "Creating…" : "Create draft contract"}
        </button>
      </form>
    </div>
  );
}
