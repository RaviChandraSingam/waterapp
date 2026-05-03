import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../App';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function MonthlyRecordsPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, periodStartDate: '', periodEndDate: '', midPeriodDate: '' });
  const [error, setError] = useState('');

  useEffect(() => { loadRecords(); }, []);

  async function loadRecords() {
    try {
      const data = await api.getMonthlyRecords();
      setRecords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createMonthlyRecord(form);
      setShowCreate(false);
      loadRecords();
    } catch (err) {
      setError(err.message);
    }
  }

  const canCreate = user.role === 'accountant' || user.role === 'watercommittee';
  const canExport = user.role !== 'plumber';

  return (
    <div>
      <div className="page-header">
        <h1>Monthly Records</h1>
        {canCreate && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Record</button>}
      </div>

      {loading ? <div className="card">Loading...</div> : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Cost/Litre</th>
                <th>Created By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}>
                  <td><Link to={`/records/${r.id}`} style={{ color: '#1976d2', fontWeight: 500 }}>{MONTH_NAMES[r.month]} {r.year}</Link></td>
                  <td>{r.period_start_date?.split('T')[0]}</td>
                  <td>{r.period_end_date?.split('T')[0]}</td>
                  <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                  <td style={{ textAlign: 'right' }}>{r.cost_per_litre ? `₹${Number(r.cost_per_litre).toFixed(4)}` : '-'}</td>
                  <td>{r.created_by_name || '-'}</td>
                  <td>
                    <Link to={`/records/${r.id}`} className="btn btn-sm btn-secondary">View</Link>
                    {canExport && r.status !== 'draft' && (
                      <>
                        <button className="btn btn-sm btn-success" style={{ marginLeft: 5 }}
                          onClick={() => api.exportExcel(r.id).catch(err => alert(err.message))}>
                          Excel
                        </button>
                        <button className="btn btn-sm btn-secondary" style={{ marginLeft: 5 }}
                          onClick={() => api.exportBillingCSV(r.id).catch(err => alert(err.message))}>
                          Billing CSV
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td colSpan={7} className="empty-state">No records yet. Create a new monthly record to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Create Monthly Record</h2>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={handleCreate}>
              <div className="grid-2">
                <div className="form-group">
                  <label>Year</label>
                  <input type="number" value={form.year} onChange={e => setForm({ ...form, year: parseInt(e.target.value) })} required />
                </div>
                <div className="form-group">
                  <label>Month</label>
                  <select value={form.month} onChange={e => setForm({ ...form, month: parseInt(e.target.value) })}>
                    {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Period Start Date</label>
                <input type="date" value={form.periodStartDate} onChange={e => setForm({ ...form, periodStartDate: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Mid Period Date (optional)</label>
                <input type="date" value={form.midPeriodDate} onChange={e => setForm({ ...form, midPeriodDate: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Period End Date</label>
                <input type="date" value={form.periodEndDate} onChange={e => setForm({ ...form, periodEndDate: e.target.value })} required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
