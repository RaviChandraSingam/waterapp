import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../App';

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString();
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
}

export default function VariationReportPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [reportRows, setReportRows] = useState([]);
  const [filterTerm, setFilterTerm] = useState('');
  const [sortDir, setSortDir] = useState(null); // null | 'asc' | 'desc'
  const [savedRows, setSavedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState('');
  const [saveStatuses, setSaveStatuses] = useState({});
  const [reasonInputs, setReasonInputs] = useState({});
  const [editReason, setEditReason] = useState({});
  const [editingSavedId, setEditingSavedId] = useState(null);

  useEffect(() => {
    loadRecords();
  }, []);

  useEffect(() => {
    if (user.role !== 'guest') {
      loadSavedRows();
    }
  }, [user.role]);

  async function loadRecords() {
    try {
      const data = await api.getMonthlyRecords();
      setRecords(data.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      }));
    } catch (err) {
      console.error(err);
      setError('Unable to load monthly records');
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedRows() {
    try {
      const data = await api.getSavedVariationExceptions();
      setSavedRows(data);
    } catch (err) {
      console.error(err);
    }
  }

  function toggleMonthSelection(id) {
    setSelectedMonths(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function runReport() {
    if (selectedMonths.length < 2) {
      setError('Select at least two months to compare');
      return;
    }
    setError('');
    setReportLoading(true);
    try {
      const data = await api.getVariationReport(selectedMonths);
      setReportRows(data.rows || []);
    } catch (err) {
      setError(err.message || 'Failed to load variation report');
    } finally {
      setReportLoading(false);
    }
  }

  const existingSaved = savedRows.reduce((map, row) => {
    const key = `${row.flat_id}|${row.month_labels.join('|')}`;
    map[key] = row;
    return map;
  }, {});

  function getRowSavedKey(row) {
    return `${row.flatId}|${row.monthLabels.join('|')}`;
  }

  async function handleSaveRow(row) {
    const reason = (reasonInputs[row.flatId] || '').trim();
    if (!reason) {
      setError('Please enter a reason before saving');
      return;
    }
    setError('');
    setSaveStatuses(prev => ({ ...prev, [row.flatId]: 'saving' }));
    try {
      await api.saveVariationException({
        flatId: row.flatId,
        flatNumber: row.flatNumber,
        blockName: row.blockName,
        monthlyRecordIds: selectedMonths,
        monthLabels: row.monthLabels,
        variationLitres: row.variationLitres,
        variationPct: row.variationPct,
        reason,
      });
      await loadSavedRows();
      setSaveStatuses(prev => ({ ...prev, [row.flatId]: 'saved' }));
    } catch (err) {
      setError(err.message || 'Failed to save exception');
      setSaveStatuses(prev => ({ ...prev, [row.flatId]: 'error' }));
    }
  }

  async function handleUpdateSaved(row) {
    const reason = (editReason[row.id] || '').trim();
    if (!reason) {
      setError('Please enter a reason to update');
      return;
    }
    setError('');
    try {
      await api.updateVariationException(row.id, { reason });
      await loadSavedRows();
      setEditingSavedId(null);
    } catch (err) {
      setError(err.message || 'Failed to update record');
    }
  }

  async function handleDeleteSaved(row) {
    if (!window.confirm('Soft delete this saved exception?')) return;
    try {
      await api.deleteVariationException(row.id);
      await loadSavedRows();
    } catch (err) {
      setError(err.message || 'Failed to delete record');
    }
  }

  const canDelete = user.role === 'watercommittee' || user.canManageUsers || user.isSuperadmin;

  // Apply filter and sort to report rows for display
  const displayedReportRows = reportRows
    .filter(row => {
      if (!filterTerm) return true;
      const term = filterTerm.toLowerCase();
      // Check block, flat, month labels, values, variation
      if ((row.blockName || '').toLowerCase().includes(term)) return true;
      if ((row.flatNumber || '').toLowerCase().includes(term)) return true;
      if (row.monthLabels && row.monthLabels.join(' ').toLowerCase().includes(term)) return true;
      if (String(row.variationLitres).toLowerCase().includes(term)) return true;
      if (String(row.variationPct ?? '').toLowerCase().includes(term)) return true;
      // Check numeric values in months
      if (row.monthKeys && Object.values(row.values || {}).some(v => String(v).toLowerCase().includes(term))) return true;
      return false;
    })
    .sort((a, b) => {
      if (!sortDir) return 0;
      const aVal = a.variationPct ?? a.variationLitres ?? 0;
      const bVal = b.variationPct ?? b.variationLitres ?? 0;
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

  return (
    <div>
      <div className="page-header">
        <h1>Variation Report</h1>
      </div>

      <div className="card">
        <div className="form-group">
          <label>Select months to compare</label>
          <div className="grid-3" style={{ gap: 10 }}>
            {records.map(record => (
              <label key={record.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selectedMonths.includes(record.id)}
                  onChange={() => toggleMonthSelection(record.id)}
                />
                {MONTH_NAMES[record.month]} {record.year}
              </label>
            ))}
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={runReport} disabled={reportLoading}>
            {reportLoading ? 'Running report...' : 'Run Report'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h2>Query Results</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>Results</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                placeholder="Filter (any column)"
                value={filterTerm}
                onChange={e => setFilterTerm(e.target.value)}
                style={{ padding: '6px 8px', minWidth: 200 }}
              />
              <button
                className="btn"
                onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
                title="Toggle sort by Δ %"
              >
                Sort Δ % {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : ''}
              </button>
            </div>
          </div>
          {reportLoading ? (
          <div>Loading report...</div>
        ) : reportRows.length === 0 ? (
          <div className="empty-state">No report rows available. Select months and run the report.</div>
        ) : (
          <table className="variation-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Flat</th>
                  {reportRows[0]?.monthLabels?.map(label => (
                    <th key={label}>{label}</th>
                  ))}
                <th style={{ textAlign: 'right' }}>Δ Litres</th>
                  <th
                    style={{ textAlign: 'right', cursor: 'pointer' }}
                    onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
                  >
                    Δ % {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : ''}
                  </th>
                <th>Reason</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
                {displayedReportRows.map(row => {
                const savedKey = getRowSavedKey(row);
                const saved = existingSaved[savedKey];
                const saveStatus = saveStatuses[row.flatId];
                return (
                    <tr key={`${row.flatId}-${row.monthLabels.join('-')}`} className={row.isTop ? 'highlight-row' : ''}>
                    <td>{row.blockName}</td>
                    <td>{row.flatNumber}</td>
                    {row.monthKeys?.map(key => (
                      <td key={key} style={{ textAlign: 'right' }}>{formatNumber(row.values[key])}</td>
                    ))}
                    <td style={{ textAlign: 'right' }}>{formatNumber(row.variationLitres)}</td>
                    <td style={{ textAlign: 'right' }}>{formatPercent(row.variationPct)}</td>
                    <td>
                      <textarea
                        rows={2}
                        value={reasonInputs[row.flatId] || ''}
                        onChange={e => setReasonInputs(prev => ({ ...prev, [row.flatId]: e.target.value }))}
                        disabled={user.role === 'guest' || !!saved}
                        placeholder={saved ? 'Already saved' : 'Enter reason'}
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSaveRow(row)}
                        disabled={user.role === 'guest' || !!saved || saveStatus === 'saving'}
                      >
                        {saved ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {user.role !== 'guest' && (
        <div className="card">
          <div className="page-header">
            <h2>Saved Exceptions</h2>
          </div>
          {savedRows.length === 0 ? (
            <div className="empty-state">No saved exceptions yet.</div>
          ) : (
            <table className="variation-table">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Flat</th>
                  <th>Months</th>
                  <th>Δ Litres</th>
                  <th>Δ %</th>
                  <th>Reason</th>
                  <th>Saved By</th>
                  <th>Saved At</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedRows.map(row => (
                  <tr key={row.id} className="saved-row">
                    <td>{row.block_name}</td>
                    <td>{row.flat_number}</td>
                    <td>{row.month_labels.join(' → ')}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(row.variation_litres)}</td>
                    <td style={{ textAlign: 'right' }}>{formatPercent(row.variation_pct)}</td>
                    <td>
                      {editingSavedId === row.id ? (
                        <textarea
                          rows={2}
                          value={editReason[row.id] ?? row.reason}
                          onChange={e => setEditReason(prev => ({ ...prev, [row.id]: e.target.value }))}
                        />
                      ) : (
                        <div>{row.reason}</div>
                      )}
                    </td>
                    <td>{row.created_by_name || 'Unknown'}</td>
                    <td>{row.created_at?.split('T')[0] || '-'}</td>
                    <td>{row.updated_by_name ? `${row.updated_by_name} ${row.updated_at?.split('T')[0] || ''}` : '-'}</td>
                    <td>
                      {editingSavedId === row.id ? (
                        <>
                          <button className="btn btn-success btn-sm" onClick={() => handleUpdateSaved(row)}>Save</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditingSavedId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingSavedId(row.id);
                              setEditReason(prev => ({ ...prev, [row.id]: row.reason }));
                            }}
                          >
                            Edit
                          </button>
                          {canDelete && (
                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteSaved(row)}>
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
