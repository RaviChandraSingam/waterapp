import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAuth } from '../App';

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ReadingsCapturePage() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [flats, setFlats] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState('');
  const [selectedBlock, setSelectedBlock] = useState('');
  const [selectedFlat, setSelectedFlat] = useState('');
  const [readingSequence, setReadingSequence] = useState(1);
  const [readingDate, setReadingDate] = useState(new Date().toISOString().split('T')[0]);
  const [readingValues, setReadingValues] = useState({});
  const [existingReadings, setExistingReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [mode, setMode] = useState('bulk'); // 'bulk' or 'single'
  const [singleValue, setSingleValue] = useState('');
  const [auditLog, setAuditLog] = useState([]);
  const [showAudit, setShowAudit] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [prevMonthReadings, setPrevMonthReadings] = useState([]);

  const recordObj = records.find(r => r.id === selectedRecord);
  const isEditable = recordObj && recordObj.status !== 'reviewed' && recordObj.status !== 'final';
  const canEdit = user.role === 'accountant' || user.role === 'watercommittee';

  useEffect(() => {
    async function load() {
      const [recs, bls] = await Promise.all([api.getMonthlyRecords(), api.getBlocks()]);
      setRecords(recs);
      setBlocks(bls);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (selectedBlock) {
      api.getBlockFlats(selectedBlock).then(setFlats);
      setSelectedFlat('');
    }
  }, [selectedBlock]);

  useEffect(() => {
    if (selectedRecord && selectedBlock) {
      api.getBlockReadings(selectedRecord, selectedBlock).then(data => {
        setExistingReadings(data);
        const values = {};
        data.forEach(r => {
          if (r.reading_sequence === readingSequence) {
            values[r.flat_id] = r.reading_value;
          }
        });
        setReadingValues(values);
      });
      api.getPreviousReadings(selectedRecord, selectedBlock).then(setPrevMonthReadings).catch(() => setPrevMonthReadings([]));
    }
  }, [selectedRecord, selectedBlock, readingSequence]);

  async function handleSaveBulk() {
    if (!isEditable) {
      setMessage(`Error: Cannot save — record is in '${recordObj?.status}' status`);
      return;
    }
    setSaving(true);
    setMessage('');
    setWarnings([]);

    const readings = Object.entries(readingValues)
      .filter(([_, val]) => val !== '' && val !== undefined)
      .map(([flatId, readingValue]) => ({
        monthlyRecordId: selectedRecord,
        flatId,
        readingDate,
        readingValue: parseFloat(readingValue),
        readingSequence,
      }));

    if (readings.length === 0) {
      setMessage('No readings to save');
      setSaving(false);
      return;
    }

    try {
      const result = await api.captureReadings(readings);
      setMessage(`Saved ${result.results.length} readings successfully!`);
      if (result.warnings?.length > 0) setWarnings(result.warnings);
      // Refresh
      api.getBlockReadings(selectedRecord, selectedBlock).then(setExistingReadings);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSingle() {
    if (!isEditable) {
      setMessage(`Error: Cannot save — record is in '${recordObj?.status}' status`);
      return;
    }
    if (!selectedFlat || !singleValue) {
      setMessage('Error: Select a flat and enter a reading value');
      return;
    }
    setSaving(true);
    setMessage('');
    setWarnings([]);

    try {
      const result = await api.captureReadings([{
        monthlyRecordId: selectedRecord,
        flatId: selectedFlat,
        readingDate,
        readingValue: parseFloat(singleValue),
        readingSequence,
      }]);
      const flatNum = flats.find(f => f.id === selectedFlat)?.flat_number;
      setMessage(`Reading saved for flat ${flatNum}!`);
      if (result.warnings?.length > 0) setWarnings(result.warnings);
      setSingleValue('');
      // Refresh
      api.getBlockReadings(selectedRecord, selectedBlock).then(data => {
        setExistingReadings(data);
        const values = {};
        data.forEach(r => {
          if (r.reading_sequence === readingSequence) values[r.flat_id] = r.reading_value;
        });
        setReadingValues(values);
      });
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateReading(readingId) {
    if (!editValue) return;
    try {
      await api.updateReading(readingId, { readingValue: parseFloat(editValue), readingDate });
      setMessage('Reading updated successfully!');
      setEditingId(null);
      setEditValue('');
      api.getBlockReadings(selectedRecord, selectedBlock).then(data => {
        setExistingReadings(data);
        const values = {};
        data.forEach(r => {
          if (r.reading_sequence === readingSequence) values[r.flat_id] = r.reading_value;
        });
        setReadingValues(values);
      });
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  async function loadAuditLog() {
    if (!selectedRecord) return;
    try {
      const data = await api.getReadingAudit(selectedRecord);
      setAuditLog(data);
      setShowAudit(true);
    } catch (err) {
      setMessage(`Error loading audit log: ${err.message}`);
    }
  }

  if (loading) return <div className="card">Loading...</div>;

  const blockFlats = flats.sort((a, b) => a.flat_number.localeCompare(b.flat_number));

  return (
    <div>
      <div className="page-header">
        <h1>Capture Meter Readings</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedRecord && canEdit && (
            <button className="btn btn-secondary" onClick={loadAuditLog}>Audit Log</button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="grid-3" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label>Monthly Record</label>
            <select value={selectedRecord} onChange={e => setSelectedRecord(e.target.value)}>
              <option value="">Select period...</option>
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
              <option value="">Select block...</option>
              {blocks.map(b => <option key={b.id} value={b.id}>{b.display_name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Reading Sequence</label>
            <select value={readingSequence} onChange={e => setReadingSequence(parseInt(e.target.value))}>
              <option value={1}>Reading 1 (Start of Month)</option>
              <option value={2}>Reading 2 (Mid Month)</option>
              <option value={3}>Reading 3 (End of Month)</option>
            </select>
          </div>
        </div>
        <div className="grid-3">
          <div className="form-group">
            <label>Reading Date</label>
            <input type="date" value={readingDate} onChange={e => setReadingDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Entry Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value)}>
              <option value="bulk">Bulk (all flats)</option>
              <option value="single">Single flat</option>
            </select>
          </div>
          {mode === 'single' && (
            <div className="form-group">
              <label>Flat Number</label>
              <select value={selectedFlat} onChange={e => {
                const flatId = e.target.value;
                setSelectedFlat(flatId);
                // Pre-fill with current captured value if it exists
                const existing = existingReadings.find(r => r.flat_id === flatId && r.reading_sequence === readingSequence);
                setSingleValue(existing ? String(existing.reading_value) : '');
              }}>
                <option value="">Select flat...</option>
                {blockFlats.map(f => {
                  const existing = existingReadings.find(r => r.flat_id === f.id && r.reading_sequence === readingSequence);
                  return (
                    <option key={f.id} value={f.id}>
                      {f.flat_number} {existing ? `(current: ${existing.reading_value})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        {recordObj && !isEditable && (
          <div className="alert alert-warning" style={{ marginTop: 12 }}>
            This record is in <strong>{recordObj.status}</strong> status. Readings cannot be added or modified.
          </div>
        )}
      </div>

      {message && <div className={`alert ${message.startsWith('Error') ? 'alert-error' : 'alert-success'}`}>{message}</div>}

      {warnings.length > 0 && (
        <div className="alert alert-warning">
          <strong>Warnings detected:</strong>
          <ul style={{ margin: '10px 0 0 20px' }}>
            {warnings.map((w, i) => <li key={i}>{w.warning}</li>)}
          </ul>
        </div>
      )}

      {/* Single flat entry */}
      {mode === 'single' && selectedRecord && selectedBlock && selectedFlat && (
        <div className="card">
          <h3>Enter Reading — Flat {flats.find(f => f.id === selectedFlat)?.flat_number}</h3>
          {(() => {
            const prevMonthReading = prevMonthReadings.find(r => r.flat_id === selectedFlat);
            const existing = existingReadings.find(r => r.flat_id === selectedFlat && r.reading_sequence === readingSequence);
            return (
              <div style={{ marginTop: 12 }}>
                {prevMonthReading && (
                  <div style={{ background: '#f0f4ff', padding: '8px 12px', borderRadius: 6, marginBottom: 12, border: '1px solid #c5d5f5' }}>
                    <span style={{ color: '#555' }}>Last Month Closing Reading: </span>
                    <strong style={{ fontSize: '1.1em' }}>{prevMonthReading.reading_value}</strong>
                  </div>
                )}
                {existing && <p style={{ color: '#666' }}>Current saved value: <strong>{existing.reading_value}</strong> (captured by {existing.captured_by_name || 'unknown'})</p>}
                <div className="grid-2" style={{ maxWidth: 400 }}>
                  <div className="form-group">
                    <label>Meter Reading</label>
                    <input
                      type="number"
                      step="1"
                      value={singleValue}
                      onChange={e => setSingleValue(e.target.value)}
                      placeholder={existing ? String(existing.reading_value) : 'Enter reading'}
                      autoFocus
                    />
                  </div>
                  <div className="form-group" style={{ alignSelf: 'flex-end' }}>
                    <button className="btn btn-primary" onClick={handleSaveSingle} disabled={saving || !isEditable}>
                      {saving ? 'Saving...' : existing ? 'Update Reading' : 'Save Reading'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Bulk entry table */}
      {mode === 'bulk' && selectedRecord && selectedBlock && blockFlats.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>Enter Readings — {blocks.find(b => b.id === selectedBlock)?.display_name}</h3>
            <button className="btn btn-primary" onClick={handleSaveBulk} disabled={saving || !isEditable}>
              {saving ? 'Saving...' : 'Save All Readings'}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Flat No</th>
                <th>Last Month Closing</th>
                <th style={{ width: 180 }}>Current Reading</th>
                <th>Captured By</th>
                <th>Status</th>
                {canEdit && isEditable && <th style={{ width: 100 }}>Edit</th>}
              </tr>
            </thead>
            <tbody>
              {blockFlats.map(flat => {
                const existing = existingReadings.find(r => r.flat_id === flat.id && r.reading_sequence === readingSequence);
                const prevMonthReading = prevMonthReadings.find(r => r.flat_id === flat.id);

                return (
                  <tr key={flat.id} className={existing?.has_warning ? 'warning-row' : ''}>
                    <td style={{ fontWeight: 600 }}>{flat.flat_number}</td>
                    <td style={{ color: '#555', background: '#f8f9fa' }}>{prevMonthReading?.reading_value ?? '-'}</td>
                    <td>
                      {editingId === existing?.reading_id ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="1"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            style={{ width: 100 }}
                            autoFocus
                          />
                          <button className="btn btn-sm" onClick={() => handleUpdateReading(existing.reading_id)}>✓</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)}>✕</button>
                        </div>
                      ) : (
                        <input
                          type="number"
                          step="1"
                          value={readingValues[flat.id] || ''}
                          onChange={e => setReadingValues({ ...readingValues, [flat.id]: e.target.value })}
                          placeholder={existing ? String(existing.reading_value) : 'Enter reading'}
                          style={{ width: '100%' }}
                          disabled={!isEditable}
                        />
                      )}
                    </td>
                    <td style={{ fontSize: '0.85em', color: '#666' }}>{existing?.captured_by_name || '-'}</td>
                    <td>
                      {existing?.has_warning && <span className="badge badge-warning" title={existing.warning_message}>⚠️ Warning</span>}
                      {existing && !existing.has_warning && <span className="badge badge-final">✓ Saved</span>}
                    </td>
                    {canEdit && isEditable && (
                      <td>
                        {existing && (
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => { setEditingId(existing.reading_id); setEditValue(String(existing.reading_value)); }}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit Log Modal */}
      {showAudit && (
        <div className="modal-overlay" onClick={() => setShowAudit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div className="modal-header">
              <h2>Audit Log — {recordObj ? `${MONTH_NAMES[recordObj.month]} ${recordObj.year}` : ''}</h2>
              <button className="modal-close" onClick={() => setShowAudit(false)}>&times;</button>
            </div>
            {auditLog.length === 0 ? (
              <p style={{ padding: 20, color: '#666' }}>No audit entries for this record.</p>
            ) : (
              <div style={{ maxHeight: 500, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Old Value</th>
                      <th>New Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map(a => {
                      const oldVals = a.old_values ? (typeof a.old_values === 'string' ? JSON.parse(a.old_values) : a.old_values) : null;
                      const newVals = a.new_values ? (typeof a.new_values === 'string' ? JSON.parse(a.new_values) : a.new_values) : null;
                      return (
                        <tr key={a.id}>
                          <td style={{ fontSize: '0.8em', whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString()}</td>
                          <td>{a.user_name} ({a.username})</td>
                          <td><span className={`badge ${a.action === 'capture_reading' ? 'badge-success' : 'badge-warning'}`}>{a.action.replace(/_/g, ' ')}</span></td>
                          <td style={{ fontSize: '0.85em' }}>{oldVals ? `${oldVals.reading_value}` : '-'}</td>
                          <td style={{ fontSize: '0.85em' }}>{newVals ? `${newVals.reading_value} (Flat: ${newVals.flat_id?.substring(0,8)}..., Seq: ${newVals.reading_sequence})` : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
