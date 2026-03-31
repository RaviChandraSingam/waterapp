import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAuth } from '../App';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [blockData, setBlockData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [sum, tr] = await Promise.all([
        api.getDashboardSummary(),
        api.getConsumptionTrend(),
      ]);
      setSummary(sum);
      setTrend(tr);

      if (sum.latestRecord) {
        const bd = await api.getBlockConsumption(sum.latestRecord.id);
        setBlockData(bd);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="card">Loading dashboard...</div>;

  const latest = summary?.latestRecord;

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <span style={{ color: '#666' }}>Welcome, {user.fullName}</span>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{summary?.totalFlats || 0}</div>
          <div className="stat-label">Total Flats</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary?.blockStats?.length || 0}</div>
          <div className="stat-label">Blocks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {latest ? `${MONTH_NAMES[latest.month]} ${latest.year}` : 'N/A'}
          </div>
          <div className="stat-label">Latest Period</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: summary?.warningCount > 0 ? '#ff9800' : '#4caf50' }}>
            {summary?.warningCount || 0}
          </div>
          <div className="stat-label">Active Warnings</div>
        </div>
      </div>

      {latest && (
        <div className="grid-2">
          <div className="card">
            <div className="card-header">
              <h3>Current Period Summary</h3>
              <span className={`badge badge-${latest.status}`}>{latest.status}</span>
            </div>
            <table>
              <tbody>
                <tr><td>Total Water Input</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(latest.total_water_input || 0).toLocaleString()} L</td></tr>
                <tr><td>Total Water Usage</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(latest.total_water_usage || 0).toLocaleString()} L</td></tr>
                <tr><td>Cost per Litre</td><td style={{ textAlign: 'right', fontWeight: 600 }}>₹{Number(latest.cost_per_litre || 0).toFixed(4)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Block-wise Consumption</h3>
            </div>
            <table>
              <thead><tr><th>Block</th><th style={{ textAlign: 'right' }}>Consumption (L)</th><th style={{ textAlign: 'right' }}>Total Cost (₹)</th></tr></thead>
              <tbody>
                {blockData.map(b => (
                  <tr key={b.block_name}>
                    <td>{b.display_name}</td>
                    <td style={{ textAlign: 'right' }}>{Number(b.total_consumption).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>₹{Number(b.total_cost).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3>Monthly Trend</h3>
        </div>
        {trend.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th style={{ textAlign: 'right' }}>Water Input (L)</th>
                <th style={{ textAlign: 'right' }}>Water Usage (L)</th>
                <th style={{ textAlign: 'right' }}>Cost/Litre (₹)</th>
                <th style={{ textAlign: 'right' }}>Total Billing (₹)</th>
              </tr>
            </thead>
            <tbody>
              {trend.map(t => (
                <tr key={`${t.year}-${t.month}`}>
                  <td>{MONTH_NAMES[t.month]} {t.year}</td>
                  <td style={{ textAlign: 'right' }}>{Number(t.total_water_input || 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{Number(t.total_water_usage || 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>₹{Number(t.cost_per_litre || 0).toFixed(4)}</td>
                  <td style={{ textAlign: 'right' }}>₹{Number(t.total_billing || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <span className="emoji">📊</span>
            <p>No trend data available yet</p>
          </div>
        )}
      </div>

      {summary?.blockStats && (
        <div className="card">
          <div className="card-header">
            <h3>Block Statistics</h3>
          </div>
          <table>
            <thead><tr><th>Block</th><th style={{ textAlign: 'right' }}>Flats</th></tr></thead>
            <tbody>
              {summary.blockStats.map(b => (
                <tr key={b.name}>
                  <td>{b.display_name}</td>
                  <td style={{ textAlign: 'right' }}>{b.flat_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
