import { Link, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import Companies from "./pages/Companies.jsx";
import CompanySetup from "./pages/CompanySetup.jsx";
import Templates from "./pages/Templates.jsx";
import CreateEnvelope from "./pages/CreateEnvelope.jsx";
import EnvelopeDetail from "./pages/EnvelopeDetail.jsx";
import SignRoom from "./pages/SignRoom.jsx";

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Attest home">
          <img
            className="brand-logo"
            src="/medialaunch-logo.png"
            alt="Media Launch"
            width={160}
            height={24}
          />
          <span className="brand-copy">
            <span className="brand-mark">attest</span>
            <span className="brand-sub">Contracts</span>
          </span>
        </Link>
        <nav className="nav-links">
          <Link to="/companies">Companies</Link>
          <Link to="/templates">Templates</Link>
          <Link to="/">Contracts</Link>
          <Link className="btn" to="/new">
            New contract
          </Link>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/companies/:id" element={<CompanySetup />} />
          <Route path="/entities" element={<Companies />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/new" element={<CreateEnvelope />} />
          <Route path="/envelopes/:id" element={<EnvelopeDetail />} />
          <Route path="/sign/:token" element={<SignRoom />} />
        </Routes>
      </main>
    </div>
  );
}
