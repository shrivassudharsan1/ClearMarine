import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ReportDebris from './pages/ReportDebris';
import Dashboard from './pages/Dashboard';
import VesselStation from './pages/VesselStation';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/report" replace />} />
        <Route path="/report" element={<ReportDebris />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/vessel/:vesselId" element={<VesselStation />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
