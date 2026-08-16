const base = "";

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: () => request("/api/health"),
  bootstrap: () => request("/api/bootstrap"),
  listEntities: () => request("/api/entities"),
  getEntity: (id) => request(`/api/entities/${id}`),
  createEntity: (body) =>
    request("/api/entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateEntity: (id, body) =>
    request(`/api/entities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteEntity: (id) => request(`/api/entities/${id}`, { method: "DELETE" }),
  uploadEntityAsset: (id, kind, file, name) => {
    const body = new FormData();
    body.append("kind", kind);
    if (name) body.append("name", name);
    body.append("file", file);
    return request(`/api/entities/${id}/assets`, { method: "POST", body });
  },
  listTemplates: () => request("/api/templates"),
  getTemplate: (id) => request(`/api/templates/${id}`),
  getMasterTemplate: () => request("/api/templates/master"),
  updateMasterTemplate: (body) =>
    request("/api/templates/master", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  uploadMasterTemplate: (file, { name, description } = {}) => {
    const body = new FormData();
    if (name) body.append("name", name);
    if (description) body.append("description", description);
    body.append("file", file);
    return request("/api/templates/master/file", { method: "POST", body });
  },
  listAppendices: (industry) =>
    request(
      `/api/appendices${industry ? `?industry=${encodeURIComponent(industry)}` : ""}`
    ),
  createAppendix: ({ name, industry, description, file }) => {
    const body = new FormData();
    body.append("name", name);
    body.append("industry", industry);
    if (description) body.append("description", description);
    body.append("file", file);
    return request("/api/appendices", { method: "POST", body });
  },
  updateAppendix: (id, body) =>
    request(`/api/appendices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  uploadAppendixFile: (id, file) => {
    const body = new FormData();
    body.append("file", file);
    return request(`/api/appendices/${id}/file`, { method: "POST", body });
  },
  listEnvelopes: () => request("/api/envelopes"),
  getEnvelope: (id) => request(`/api/envelopes/${id}`),
  createEnvelope: (body) =>
    request("/api/envelopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  brandPack: (entityId, { industry, appendixIds = [] } = {}) => {
    const params = new URLSearchParams({ entityId });
    if (industry) params.set("industry", industry);
    if (appendixIds.length) params.set("appendixIds", appendixIds.join(","));
    return request(`/api/brand-pack?${params}`);
  },
  bakeEnvelope: (id) => request(`/api/envelopes/${id}/bake`, { method: "POST" }),
  sendEnvelope: (id) => request(`/api/envelopes/${id}/send`, { method: "POST" }),
  voidEnvelope: (id, reason) =>
    request(`/api/envelopes/${id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  partyLink: (envelopeId, partyId) =>
    request(`/api/envelopes/${envelopeId}/parties/${partyId}/link`, {
      method: "POST",
    }),
  verifyEvents: (envelopeId) =>
    request(`/api/events/verify${envelopeId ? `?envelopeId=${envelopeId}` : ""}`),
  signSession: (token) => request(`/api/sign/${token}`),
  saveField: (token, fieldId, value) =>
    request(`/api/sign/${token}/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId, value }),
    }),
  uploadEvidence: (token, requirementId, file) => {
    const body = new FormData();
    body.append("requirementId", requirementId);
    body.append("file", file);
    return request(`/api/sign/${token}/evidence`, { method: "POST", body });
  },
  sign: (token, payload) =>
    request(`/api/sign/${token}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  decline: (token, reason) =>
    request(`/api/sign/${token}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  documentUrl: (id, kind) => `/api/envelopes/${id}/documents/${kind}`,
  entityAssetUrl: (entityId, assetId) => `/api/entities/${entityId}/assets/${assetId}/file`,
};
