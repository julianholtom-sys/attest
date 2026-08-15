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
  listTemplates: () => request("/api/templates"),
  getTemplate: (id) => request(`/api/templates/${id}`),
  listEnvelopes: () => request("/api/envelopes"),
  getEnvelope: (id) => request(`/api/envelopes/${id}`),
  createEnvelope: (body) =>
    request("/api/envelopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
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
};
