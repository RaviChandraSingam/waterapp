import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAuth } from '../App';

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function BillingPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState('');
  const [billing, setBilling] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [recs, bls] = await Promise.all([api.getMonthlyRecords(), api.getBlocks()]);
      setRecords(recs);
      setBlocks(bls);
      if (recs.length > 0) setSelectedRecord(recs[0].id);
      if (bls.length > 0) setSelectedBlock(bls[0].id);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (selectedRecord && selectedBlock) {
      api.getBlockBilling(selectedRecord, selectedBlock).then(setBilling);
    }
  }, [selectedRecord, selectedBlock]);

  if (loading) return <div className="card">Loading...</div>;

  const totalConsumption = billing.reduce((sum, b) => sum + Number(b.consumption_litres || 0), 0);
  const totalCost = billing.reduce((sum, b) => sum + Number(b.total_cost || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h1>Billing & Reports</h1>
        {user.role !== 'plumber' && selectedRecord && (
          <button className="btn btn-success" onClick={() => api.exportExcel(selectedRecord)}>
            Download Excel
          </button>
        )}
      </div>

      <div className="card">
        <div className="grid-2" style={{ marginBottom: 10 }}>
          <div className="form-group">
            <label>Monthly Record</label>
            <select value={selectedRecord} onChange={e => setSelectedRecord(e.target.value)}>
              {records.map(r => (
                <option key={r.id} value={r.id}>
                  {MONTH_NAMES[r.month]} {r.year} ({r.status})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Block</label>
            <select value={selectedBlock} onChange={e => setSelectedBlock(e.target.value)}>
              {blocks.map(b => <option key={b.id} value={b.id}>{b.display_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{billing.length}</div>
          <div className="stat-label">Flats</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalConsumption.toLocaleString()}</div>
          <div className="stat-label">Total Consumption (L)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">₹{totalCost.toFixed(2)}</div>
          <div className="stat-label">Total Cost</div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Flat No</th>
              <th style={{ textAlign: 'right' }}>Start</th>
              <th style={{ textAlign: 'right' }}>End</th>
              <th style={{ textAlign: 'right' }}>Consumption (L)</th>
              <th style={{ textAlign: 'right' }}>Slab1</th>
              <th style={{ textAlign: 'right' }}>Slab2</th>
              <th style={{ textAlign: 'right' }}>Slab3</th>
              <th style={{ textAlign: 'right' }}>Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {billing.map(b => (
              <tr key={b.id}>
                <td style={{ fontWeight: 600 }}>{b.flat_number}</td>
                <td style={{ textAlign: 'right' }}>{Number(b.start_reading)}</td>
                <td style={{ textAlign: 'right' }}>{Number(b.end_reading)}</td>
                <td style={{ textAlign: 'right' }}>{Number(b.consumption_litres).toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>₹{Number(b.slab1_cost).toFixed(2)}</td>
                <td style={{ textAlign: 'right' }}>₹{Number(b.slab2_cost).toFixed(2)}</td>
                <td style={{ textAlign: 'right' }}>₹{Number(b.slab3_cost).toFixed(2)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{Number(b.total_cost).toFixed(2)}</td>
              </tr>
            ))}
            {billing.length > 0 && (
              <tr style={{ fontWeight: 700, background: '#f0f0f0' }}>
                <td>TOTAL</td>
                <td></td><td></td>
                <td style={{ textAlign: 'right' }}>{totalConsumption.toLocaleString()}</td>
                <td></td><td></td><td></td>
                <td style={{ textAlign: 'right' }}>₹{totalCost.toFixed(2)}</td>
              </tr>
            )}
            {billing.length === 0 && (
              <tr><td colSpan={8} className="empty-state">No billing data available. Run calculation for this period first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
