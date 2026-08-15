import { Link, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import CreateEnvelope from "./pages/CreateEnvelope.jsx";
import EnvelopeDetail from "./pages/EnvelopeDetail.jsx";
import SignPage from "./pages/SignPage.jsx";

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Attest home">
          <span className="brand-mark">Attest</span>
          <span className="brand-sub">local e-sign</span>
        </Link>
        <Link className="btn secondary" to="/new">
          New envelope
        </Link>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<CreateEnvelope />} />
          <Route path="/envelopes/:id" element={<EnvelopeDetail />} />
          <Route path="/envelopes/:id/sign" element={<SignPage />} />
        </Routes>
      </main>
    </div>
  );
}
