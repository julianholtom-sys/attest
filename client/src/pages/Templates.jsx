import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

export default function Templates() {
  const [master, setMaster] = useState(null);
  const [appendices, setAppendices] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [masterMeta, setMasterMeta] = useState({ name: "", description: "" });
  const [newAppendix, setNewAppendix] = useState({
    name: "",
    industry: "construction",
    description: "",
  });

  async function reload() {
    const [m, apps] = await Promise.all([api.getMasterTemplate(), api.listAppendices()]);
    setMaster(m);
    setMasterMeta({ name: m.name || "", description: m.description || "" });
    setAppendices(apps);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, []);

  const byIndustry = useMemo(() => {
    const map = new Map();
    for (const a of appendices) {
      if (!map.has(a.industry)) map.set(a.industry, []);
      map.get(a.industry).push(a);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [appendices]);

  async function run(label, fn) {
    setBusy(label);
    setError("");
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      <section className="hero-panel">
        <h1>Templates</h1>
        <p>
          One master contract is always sent. Add industry appendices that can be
          chosen on top of it when creating a contract.
        </p>
      </section>
      {error ? <p className="error">{error}</p> : null}

      <section className="panel form-grid" style={{ marginBottom: "1.25rem" }}>
        <h2>Master contract</h2>
        <p className="muted">
          Included on every contract. Upload a PDF to create or replace the master.
        </p>
        {master ? (
          <>
            <label>
              Name
              <input
                value={masterMeta.name}
                onChange={(e) => setMasterMeta((m) => ({ ...m, name: e.target.value }))}
              />
            </label>
            <label>
              Description
              <input
                value={masterMeta.description}
                onChange={(e) =>
                  setMasterMeta((m) => ({ ...m, description: e.target.value }))
                }
              />
            </label>
            <p className="meta">Source: {master.source_url}</p>
            <p className="meta">
              {master.roles?.length || 0} roles · {master.fields?.length || 0} fields
            </p>
            <button
              className="btn secondary"
              type="button"
              disabled={!!busy}
              onClick={() =>
                run("save-master", () => api.updateMasterTemplate(masterMeta))
              }
            >
              {busy === "save-master" ? "Saving…" : "Save master details"}
            </button>
          </>
        ) : (
          <p className="muted">No master yet — upload a PDF to add one.</p>
        )}
        <label>
          {master ? "Update master PDF" : "Upload master PDF"}
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={!!busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              run("upload-master", () =>
                api.uploadMasterTemplate(file, {
                  name: masterMeta.name || "Master Services Agreement",
                  description: masterMeta.description,
                })
              );
              e.target.value = "";
            }}
          />
        </label>
      </section>

      <section className="panel form-grid" style={{ marginBottom: "1.25rem" }}>
        <h2>Add industry appendix</h2>
        <p className="muted">
          Appendices are optional extras, filtered by industry when a contract is created.
        </p>
        <label>
          Name
          <input
            value={newAppendix.name}
            onChange={(e) => setNewAppendix((a) => ({ ...a, name: e.target.value }))}
            placeholder="Construction H&S Appendix"
          />
        </label>
        <label>
          Industry
          <input
            value={newAppendix.industry}
            onChange={(e) => setNewAppendix((a) => ({ ...a, industry: e.target.value }))}
            placeholder="construction"
          />
        </label>
        <label>
          Description
          <input
            value={newAppendix.description}
            onChange={(e) =>
              setNewAppendix((a) => ({ ...a, description: e.target.value }))
            }
          />
        </label>
        <label>
          PDF file
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={!!busy || !newAppendix.name || !newAppendix.industry}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              run("add-appendix", async () => {
                await api.createAppendix({ ...newAppendix, file });
                setNewAppendix({
                  name: "",
                  industry: newAppendix.industry,
                  description: "",
                });
              });
              e.target.value = "";
            }}
          />
        </label>
      </section>

      <section className="hero-panel" style={{ marginBottom: "0.75rem" }}>
        <h2>Industry appendices</h2>
        <p>Update details or replace the PDF for each appendix.</p>
      </section>

      {byIndustry.length === 0 ? (
        <div className="empty">No appendices yet.</div>
      ) : (
        byIndustry.map(([industry, rows]) => (
          <div key={industry} style={{ marginBottom: "1.25rem" }}>
            <h3 style={{ textTransform: "capitalize" }}>{industry}</h3>
            <div className="grid">
              {rows.map((a) => (
                <AppendixCard
                  key={a.id}
                  appendix={a}
                  busy={busy}
                  onSave={(body) => run(`save-${a.id}`, () => api.updateAppendix(a.id, body))}
                  onReplace={(file) =>
                    run(`file-${a.id}`, () => api.uploadAppendixFile(a.id, file))
                  }
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function AppendixCard({ appendix, busy, onSave, onReplace }) {
  const [form, setForm] = useState({
    name: appendix.name,
    industry: appendix.industry,
    description: appendix.description || "",
  });

  useEffect(() => {
    setForm({
      name: appendix.name,
      industry: appendix.industry,
      description: appendix.description || "",
    });
  }, [appendix]);

  return (
    <section className="panel form-grid">
      <label>
        Name
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </label>
      <label>
        Industry
        <input
          value={form.industry}
          onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
        />
      </label>
      <label>
        Description
        <input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </label>
      <button
        className="btn secondary"
        type="button"
        disabled={!!busy}
        onClick={() => onSave(form)}
      >
        Save details
      </button>
      <label>
        Replace PDF
        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={!!busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onReplace(file);
            e.target.value = "";
          }}
        />
      </label>
    </section>
  );
}
