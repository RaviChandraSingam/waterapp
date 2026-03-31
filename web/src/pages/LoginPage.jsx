import { useState } from 'react';
import { useAuth } from '../App';
import { api } from '../services/api';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login(username, password);
      login(result.user, result.token);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <span className="emoji">💧</span>
        <h1>WaterApp</h1>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: 20 }}>
          Apartment Water Consumption Management
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <div style={{ marginTop: 20, fontSize: '0.8rem', color: '#999', textAlign: 'center' }}>
          <p>Default accounts: plumber1 / accountant1 / admin1</p>
          <p>Password: password123</p>
        </div>
      </div>
    </div>
  );
}
