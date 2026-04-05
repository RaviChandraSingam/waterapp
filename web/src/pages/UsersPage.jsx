import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAuth } from '../App';

const ROLES = [
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
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.username}</td>
                <td>{u.full_name}</td>
                <td>
                  <span className={`badge ${
                    u.role === 'watercommittee' ? 'badge-primary' :
                    u.role === 'accountant' ? 'badge-warning' : 'badge-secondary'
                  }`}>
                    {ROLES.find(r => r.value === u.role)?.label || u.role}
                  </span>
                </td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
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
              <td>All accountant abilities + sign-off billing, manage users, configure system</td>
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
    </div>
  );
}
