import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAuth } from '../App';

const ROLES = [
  { value: 'guest', label: 'Guest', desc: 'Read-only view of dashboard and records' },
  { value: 'plumber', label: 'Plumber', desc: 'Capture meter readings' },
  { value: 'accountant', label: 'Accountant', desc: 'Review and modify readings, export reports' },
  { value: 'watercommittee', label: 'Water Committee', desc: 'Full admin access, sign-off billing' },
];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', fullName: '', role: 'plumber' });
  const [error, setError] = useState('');
  const [resetModal, setResetModal] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [editNameModal, setEditNameModal] = useState(null);
  const [editName, setEditName] = useState('');
  const [editNameError, setEditNameError] = useState('');

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const data = await api.getUsers();
    setUsers(data);
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!form.username || !form.password || !form.fullName) {
      setError('All fields are required');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    try {
      await api.createUser({ username: form.username, password: form.password, fullName: form.fullName, role: form.role });
      setShowCreate(false);
      setForm({ username: '', password: '', fullName: '', role: 'plumber' });
      loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to create user');
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setResetError('');
    if (!resetPassword || resetPassword.length < 8) {
      setResetError('Password must be at least 8 characters');
      return;
    }
    try {
      await api.resetUserPassword(resetModal.id, resetPassword);
      setResetModal(null);
      setResetPassword('');
      alert('Password reset successfully. User will be prompted to change it on next login.');
    } catch (err) {
      setResetError(err.message || 'Failed to reset password');
    }
  }

  async function handleEditName(e) {
    e.preventDefault();
    setEditNameError('');
    if (!editName.trim()) {
      setEditNameError('Full name is required');
      return;
    }
    try {
      await api.updateUserName(editNameModal.id, editName.trim());
      setEditNameModal(null);
      setEditName('');
      loadUsers();
    } catch (err) {
      setEditNameError(err.message || 'Failed to update name');
    }
  }

  async function toggleManageUsers(userId, currentValue) {
    try {
      await api.updateUserPermissions(userId, !currentValue);
      loadUsers();
    } catch (err) {
      alert(err.message || 'Failed to update permissions');
    }
  }

  if (loading) return <div className="card">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>User Management</h1>
        <button className="btn" onClick={() => setShowCreate(true)}>+ New User</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Role</th>
              {currentUser.isSuperadmin && <th>Can Manage Users</th>}
              <th>Created</th>
              {(currentUser.canManageUsers || currentUser.isSuperadmin) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.username}{u.is_superadmin && ' ⭐'}</td>
                <td>{u.full_name}</td>
                <td>
                  <span className={`badge ${
                    u.role === 'watercommittee' ? 'badge-primary' :
                    u.role === 'accountant' ? 'badge-warning' : 'badge-secondary'
                  }`}>
                    {ROLES.find(r => r.value === u.role)?.label || u.role}
                  </span>
                </td>
                {currentUser.isSuperadmin && (
                  <td>
                    {u.is_superadmin ? (
                      <span style={{ color: '#4caf50' }}>Always</span>
                    ) : (
                      <button
                        className={`btn btn-sm ${u.can_manage_users ? 'btn-success' : 'btn-secondary'}`}
                        onClick={() => toggleManageUsers(u.id, u.can_manage_users)}
                        style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                      >
                        {u.can_manage_users ? 'Yes' : 'No'}
                      </button>
                    )}
                  </td>
                )}
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                {(currentUser.canManageUsers || currentUser.isSuperadmin) && (
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => { setEditNameModal(u); setEditName(u.full_name); setEditNameError(''); }}
                      style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                    >
                      Edit Name
                    </button>
                    {currentUser.isSuperadmin && !u.is_superadmin && (
                      <button
                        className="btn btn-sm btn-warning"
                        onClick={() => { setResetModal(u); setResetPassword(''); setResetError(''); }}
                        style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                      >
                        Reset Password
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Role Permissions</h2>
        <table>
          <thead>
            <tr><th>Role</th><th>Description</th><th>Capabilities</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="badge" style={{ background: '#9e9e9e', color: 'white' }}>Guest</span></td>
              <td>Read-only viewer</td>
              <td>View dashboard and monthly records only — no data entry or admin access</td>
            </tr>
            <tr>
              <td><span className="badge badge-secondary">Plumber</span></td>
              <td>Meter reading capture</td>
              <td>View blocks/flats, capture weekly meter readings, view own submissions</td>
            </tr>
            <tr>
              <td><span className="badge badge-warning">Accountant</span></td>
              <td>Review &amp; reports</td>
              <td>All plumber abilities + review/modify readings, export Excel, view billing</td>
            </tr>
            <tr>
              <td><span className="badge badge-primary">Water Committee</span></td>
              <td>Full administration</td>
              <td>All accountant abilities + sign-off billing, configure system</td>
            </tr>
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Create New User</h2>
              <button className="modal-close" onClick={() => { setShowCreate(false); setError(''); }}>&times;</button>
            </div>
            <form onSubmit={handleCreate}>
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-group">
                <label>Username</label>
                <input type="text" value={form.username} onChange={e => setForm({...form, username: e.target.value})} autoFocus />
              </div>
              <div className="form-group">
                <label>Full Name</label>
                <input type="text" value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowCreate(false); setError(''); }}>Cancel</button>
                <button type="submit" className="btn">Create User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editNameModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Edit Name for {editNameModal.username}</h2>
              <button className="modal-close" onClick={() => setEditNameModal(null)}>&times;</button>
            </div>
            <form onSubmit={handleEditName}>
              {editNameError && <div className="alert alert-error">{editNameError}</div>}
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditNameModal(null)}>Cancel</button>
                <button type="submit" className="btn">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Reset Password for {resetModal.full_name}</h2>
              <button className="modal-close" onClick={() => setResetModal(null)}>&times;</button>
            </div>
            <form onSubmit={handleResetPassword}>
              {resetError && <div className="alert alert-error">{resetError}</div>}
              <p style={{ marginBottom: 12, color: '#666' }}>
                Set a new temporary password for <strong>{resetModal.username}</strong>. They will be prompted to change it on next login.
              </p>
              <div className="form-group">
                <label>New Password</label>
                <input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} autoFocus minLength={8} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setResetModal(null)}>Cancel</button>
                <button type="submit" className="btn">Reset Password</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
