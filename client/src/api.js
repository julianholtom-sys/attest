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
  listEnvelopes: () => request("/api/envelopes"),
  getEnvelope: (id) => request(`/api/envelopes/${id}`),
  createEnvelope: (formData) =>
    request("/api/envelopes", { method: "POST", body: formData }),
  updateEnvelope: (id, patch) =>
    request(`/api/envelopes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  deleteEnvelope: (id) =>
    request(`/api/envelopes/${id}`, { method: "DELETE" }),
  sign: (id, body) =>
    request(`/api/envelopes/${id}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  documentUrl: (id, signed = false) =>
    `/api/envelopes/${id}/document${signed ? "?signed=1" : ""}`,
};
