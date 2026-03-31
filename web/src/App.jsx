import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { api } from './services/api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import MonthlyRecordsPage from './pages/MonthlyRecordsPage';
import MonthlyRecordDetailPage from './pages/MonthlyRecordDetailPage';
import ReadingsCapturePage from './pages/ReadingsCapturePage';
import BillingPage from './pages/BillingPage';
import ConfigPage from './pages/ConfigPage';
import UsersPage from './pages/UsersPage';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  if (!user) {
    return (
      <AuthContext.Provider value={{ user, login, logout }}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </BrowserRouter>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <BrowserRouter>
        <div className="app">
          <Sidebar />
          <div className="main-content">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/records" element={<MonthlyRecordsPage />} />
              <Route path="/records/:id" element={<MonthlyRecordDetailPage />} />
              <Route path="/capture" element={<ReadingsCapturePage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <span className="emoji">💧</span>
        <h2>WaterApp</h2>
      </div>
      <div className="sidebar-nav">
        <div className="section-title">Main</div>
        <Link to="/" className={isActive('/') && location.pathname === '/' ? 'active' : ''}>Dashboard</Link>
        <Link to="/records" className={isActive('/records') ? 'active' : ''}>Monthly Records</Link>

        {(user.role === 'plumber' || user.role === 'watercommittee' || user.role === 'accountant') && (
          <>
            <div className="section-title">Capture</div>
            <Link to="/capture" className={isActive('/capture') ? 'active' : ''}>Meter Readings</Link>
          </>
        )}

        {(user.role === 'accountant' || user.role === 'watercommittee') && (
          <>
            <div className="section-title">Finance</div>
            <Link to="/billing" className={isActive('/billing') ? 'active' : ''}>Billing & Reports</Link>
          </>
        )}

        {user.role === 'watercommittee' && (
          <>
            <div className="section-title">Admin</div>
            <Link to="/config" className={isActive('/config') ? 'active' : ''}>Configuration</Link>
            <Link to="/users" className={isActive('/users') ? 'active' : ''}>User Management</Link>
          </>
        )}
      </div>
      <div className="sidebar-user">
        <div className="user-name">{user.fullName}</div>
        <div className="user-role">{user.role === 'watercommittee' ? 'Water Committee' : user.role}</div>
        <button onClick={logout}>Logout</button>
      </div>
    </nav>
  );
}

export default App;
