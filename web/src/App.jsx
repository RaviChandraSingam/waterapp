import { useState, createContext, useContext } from 'react';
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
import PendingItemsPage from './pages/PendingItemsPage';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [showChangePassword, setShowChangePassword] = useState(false);

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

  const updateUser = (updates) => {
    const updated = { ...user, ...updates };
    localStorage.setItem('user', JSON.stringify(updated));
    setUser(updated);
  };

  const openChangePassword = () => setShowChangePassword(true);

  if (!user) {
    return (
      <AuthContext.Provider value={{ user, login, logout, openChangePassword }}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </BrowserRouter>
      </AuthContext.Provider>
    );
  }

  const forcedChange = !!user.mustChangePassword;

  return (
    <AuthContext.Provider value={{ user, login, logout, openChangePassword }}>
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
              <Route path="/pending" element={<PendingItemsPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </div>
        </div>
        {(forcedChange || showChangePassword) && (
          <ChangePasswordModal
            forced={forcedChange}
            onClose={() => setShowChangePassword(false)}
            onSuccess={() => {
              updateUser({ mustChangePassword: false });
              setShowChangePassword(false);
            }}
          />
        )}
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

function Sidebar() {
  const { user, logout, openChangePassword } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  const close = () => setOpen(false);

  return (
    <>
      {/* Hamburger button — only visible on mobile */}
      <button className="sidebar-toggle" onClick={() => setOpen(o => !o)} aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>

      {/* Overlay — only on mobile when sidebar is open */}
      {open && <div className="sidebar-overlay" onClick={close} />}

      <nav className={`sidebar${open ? ' sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <span className="emoji">💧</span>
          <h2>WaterApp</h2>
        </div>
        <div className="sidebar-nav">
          <div className="section-title">Main</div>
          <Link to="/" onClick={close} className={isActive('/') && location.pathname === '/' ? 'active' : ''}>Dashboard</Link>
          <Link to="/records" onClick={close} className={isActive('/records') ? 'active' : ''}>Monthly Records</Link>
          <Link to="/pending" onClick={close} className={isActive('/pending') ? 'active' : ''}>Pending Items</Link>

          {(user.role === 'plumber' || user.role === 'watercommittee' || user.role === 'accountant') && (
            <>
              <div className="section-title">Capture</div>
              <Link to="/capture" onClick={close} className={isActive('/capture') ? 'active' : ''}>Meter Readings</Link>
            </>
          )}

          {(user.role === 'accountant' || user.role === 'watercommittee') && (
            <>
              <div className="section-title">Finance</div>
              <Link to="/billing" onClick={close} className={isActive('/billing') ? 'active' : ''}>Billing &amp; Reports</Link>
            </>
          )}

          {user.role === 'watercommittee' && (
            <>
              <div className="section-title">Admin</div>
              <Link to="/config" onClick={close} className={isActive('/config') ? 'active' : ''}>Configuration</Link>
            </>
          )}

          {(user.canManageUsers || user.isSuperadmin) && (
            <>
              {user.role !== 'watercommittee' && <div className="section-title">Admin</div>}
              <Link to="/users" onClick={close} className={isActive('/users') ? 'active' : ''}>User Management</Link>
            </>
          )}
        </div>
        <div className="sidebar-user">
          <div className="user-name">{user.fullName}</div>
          <div className="user-role">{user.role === 'watercommittee' ? 'Water Committee' : user.role === 'guest' ? 'Guest (Read-only)' : user.role}</div>
          {user.role !== 'guest' && (
            <button onClick={openChangePassword} style={{ marginBottom: 6 }}>Change Password</button>
          )}
          <button onClick={logout}>Logout</button>
        </div>
      </nav>
    </>
  );
}

function ChangePasswordModal({ forced, onClose, onSuccess }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>{forced ? 'Set Your Password' : 'Change Password'}</h2>
          {!forced && <button className="modal-close" onClick={onClose}>&times;</button>}
        </div>
        {forced && (
          <div className="alert" style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 4, padding: '10px 14px', marginBottom: 16 }}>
            You must change your password before continuing.
          </div>
        )}
        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label>Current Password</label>
            <input type="password" value={form.currentPassword} onChange={e => setForm({ ...form, currentPassword: e.target.value })} autoFocus required />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={form.newPassword} onChange={e => setForm({ ...form, newPassword: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input type="password" value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} required />
          </div>
          <div className="form-actions">
            {!forced && <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>}
            <button type="submit" className="btn" disabled={loading}>{loading ? 'Updating...' : 'Update Password'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
