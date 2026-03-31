import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../App';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function MonthlyRecordDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [record, setRecord] = useState(null);
  const [readings, setReadings] = useState([]);
  const [billing, setBilling] = useState([]);
  const [commonReadings, setCommonReadings] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [activeBlock, setActiveBlock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [editingCosts, setEditingCosts] = useState(false);
  const [editCostItems, setEditCostItems] = useState([]);
  const [editSourceReadings, setEditSourceReadings] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStats, setUploadStats] = useState(null);

  useEffect(() => { loadData(); }, [id]);

  async function loadData() {
    try {
      const [rec, bl, rd, cr, bill] = await Promise.all([
        api.getMonthlyRecord(id),
        api.getBlocks(),
        api.getReadings(id),
        api.getCommonAreaReadings(id),
        api.getBilling(id),
      ]);
      setRecord(rec);
      setBlocks(bl);
      setReadings(rd);
      setCommonReadings(cr);
      setBilling(bill);
      if (bl.length > 0 && !activeBlock) setActiveBlock(bl[0].id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(newStatus) {
    try {
      await api.updateStatus(id, newStatus);
      setMessage(`Status changed to "${newStatus}"`);
      loadData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  async function handleCalculate() {
    try {
      const result = await api.calculateBilling(id);
      setMessage(`Billing calculated! Cost/litre: ₹${result.costPerLitre.toFixed(4)}, ${result.flatsCalculated} flats processed.`);
      loadData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  async function startEditCosts() {
    setEditCostItems((record.cost_items || []).map(ci => ({ itemName: ci.item_name, amount: ci.amount })));
    // Load all water sources and merge with existing readings
    const allSources = await api.getWaterSources();
    const existingReadings = record.water_source_readings || [];
    const merged = allSources.map(ws => {
      const existing = existingReadings.find(r => r.water_source_id === ws.id);
      return {
        waterSourceId: ws.id,
        sourceName: ws.name,
        sourceType: ws.source_type,
        startReading: existing?.start_reading || '',
        endReading: existing?.end_reading || '',
        unitCount: existing?.unit_count || '',
        costPerUnit: existing?.cost_per_unit ?? ws.cost_per_unit ?? '',
      };
    });
    setEditSourceReadings(merged);
    setEditingCosts(true);
  }

  async function saveCosts() {
    try {
      await api.updateCostItems(id, editCostItems);
      await api.updateWaterSources(id, editSourceReadings);
      setMessage('Costs & sources saved!');
      setEditingCosts(false);
      loadData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  async function handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setMessage('');
    setUploadStats(null);
    try {
      const result = await api.uploadExcel(id, file);
      setUploadStats(result.stats);
      setMessage(`Excel imported: ${result.stats.readingsImported} readings from ${result.stats.blocksProcessed} blocks`);
      loadData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  if (loading) return <div className="card">Loading...</div>;
  if (!record) return <div className="card">Record not found</div>;

  const blockReadings = readings.filter(r => activeBlock && r.block_name === blocks.find(b => b.id === activeBlock)?.name);
  const blockBilling = billing.filter(b => activeBlock && b.block_name === blocks.find(bl => bl.id === activeBlock)?.name);

  // Group readings by flat
  const flatReadings = {};
  blockReadings.forEach(r => {
    if (!flatReadings[r.flat_number]) flatReadings[r.flat_number] = {};
    flatReadings[r.flat_number][r.reading_sequence] = r;
  });

  const canChangeStatus = {
    plumber: record.status === 'draft' ? 'captured' : null,
    accountant: record.status === 'captured' ? 'reviewed' : (record.status === 'reviewed' ? 'captured' : null),
    watercommittee: record.status === 'reviewed' ? 'final' : (record.status === 'final' ? 'reviewed' : (record.status === 'captured' ? 'reviewed' : (record.status === 'draft' ? 'captured' : null))),
  };

  const nextStatus = canChangeStatus[user.role];
  const canCalculate = (user.role === 'accountant' || user.role === 'watercommittee') && record.status !== 'final';
  const canExport = user.role !== 'plumber';
  const canUpload = (user.role === 'accountant' || user.role === 'watercommittee') && record.status !== 'reviewed' && record.status !== 'final';

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/records" style={{ color: '#666', fontSize: '0.9rem' }}>← Back to Records</Link>
          <h1>{MONTH_NAMES[record.month]} {record.year}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className={`badge badge-${record.status}`}>{record.status}</span>
          {nextStatus && (
            <button className="btn btn-primary" onClick={() => handleStatusChange(nextStatus)}>
              Mark as {nextStatus}
            </button>
          )}
          {canCalculate && <button className="btn btn-warning" onClick={handleCalculate}>Recalculate</button>}
          {canExport && <button className="btn btn-success" onClick={() => api.exportExcel(id)}>Export Excel</button>}
          {canUpload && (
            <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
              {uploading ? 'Uploading...' : 'Upload Excel'}
              <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} style={{ display: 'none' }} disabled={uploading} />
            </label>
          )}
        </div>
      </div>

      {message && <div className="alert alert-info">{message}</div>}

      {uploadStats && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px', background: '#f0f9f0', border: '1px solid #c3e6cb' }}>
          <strong>Import Summary:</strong>{' '}
          {uploadStats.readingsImported} meter readings from {uploadStats.blocksProcessed} blocks
          {uploadStats.waterSources > 0 && `, ${uploadStats.waterSources} water sources`}
          {uploadStats.costItems > 0 && `, ${uploadStats.costItems} cost items`}
          {uploadStats.commonAreas > 0 && `, ${uploadStats.commonAreas} common areas`}
          {uploadStats.skipped > 0 && <span style={{ color: '#856404' }}> ({uploadStats.skipped} skipped)</span>}
          {uploadStats.errors?.length > 0 && (
            <ul style={{ margin: '6px 0 0 20px', color: '#856404', fontSize: '0.9em' }}>
              {uploadStats.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 12 }} onClick={() => setUploadStats(null)}>Dismiss</button>
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={`tab ${activeTab === 'readings' ? 'active' : ''}`} onClick={() => setActiveTab('readings')}>Meter Readings</button>
        <button className={`tab ${activeTab === 'common' ? 'active' : ''}`} onClick={() => setActiveTab('common')}>Common Areas</button>
        <button className={`tab ${activeTab === 'billing' ? 'active' : ''}`} onClick={() => setActiveTab('billing')}>Billing</button>
        <button className={`tab ${activeTab === 'costs' ? 'active' : ''}`} onClick={() => setActiveTab('costs')}>Costs & Sources</button>
      </div>

      {activeTab === 'overview' && (
        <div className="grid-2">
          <div className="card">
            <h3 style={{ marginBottom: 15 }}>Record Details</h3>
            <table>
              <tbody>
                <tr><td>Period</td><td>{record.period_start_date?.split('T')[0]} to {record.period_end_date?.split('T')[0]}</td></tr>
                <tr><td>Mid Period</td><td>{record.mid_period_date?.split('T')[0] || '-'}</td></tr>
                <tr><td>Status</td><td><span className={`badge badge-${record.status}`}>{record.status}</span></td></tr>
                <tr><td>Cost per Litre</td><td>₹{Number(record.cost_per_litre || 0).toFixed(4)}</td></tr>
                <tr><td>Total Water Input</td><td>{Number(record.total_water_input || 0).toLocaleString()} L</td></tr>
                <tr><td>Total Water Usage</td><td>{Number(record.total_water_usage || 0).toLocaleString()} L</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 15 }}>Workflow</h3>
            <table>
              <tbody>
                <tr><td>Created By</td><td>{record.created_by_name || '-'}</td></tr>
                <tr><td>Reviewed By</td><td>{record.reviewed_by_name || '-'}</td></tr>
                <tr><td>Reviewed At</td><td>{record.reviewed_at?.split('T')[0] || '-'}</td></tr>
                <tr><td>Finalized By</td><td>{record.finalized_by_name || '-'}</td></tr>
                <tr><td>Finalized At</td><td>{record.finalized_at?.split('T')[0] || '-'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'readings' && (
        <div className="card">
          <div className="tabs" style={{ marginBottom: 15 }}>
            {blocks.map(b => (
              <button key={b.id} className={`tab ${activeBlock === b.id ? 'active' : ''}`}
                onClick={() => setActiveBlock(b.id)}>{b.display_name}</button>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>Flat No</th>
                <th style={{ textAlign: 'right' }}>Reading 1 (Start)</th>
                <th style={{ textAlign: 'right' }}>Reading 2 (Mid)</th>
                <th style={{ textAlign: 'right' }}>Reading 3 (End)</th>
                <th>Warning</th>
                <th>Captured By</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(flatReadings).sort(([a], [b]) => a.localeCompare(b)).map(([flatNo, seqs]) => (
                <tr key={flatNo} className={Object.values(seqs).some(s => s.has_warning) ? 'warning-row' : ''}>
                  <td style={{ fontWeight: 600 }}>{flatNo}</td>
                  <td style={{ textAlign: 'right' }}>{seqs[1]?.reading_value || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{seqs[2]?.reading_value || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{seqs[3]?.reading_value || '-'}</td>
                  <td>
                    {Object.values(seqs).filter(s => s.has_warning).map((s, i) => (
                      <div key={i} className="badge badge-warning" title={s.warning_message}>⚠️ Warning</div>
                    ))}
                  </td>
                  <td>{seqs[1]?.captured_by_name || '-'}</td>
                </tr>
              ))}
              {Object.keys(flatReadings).length === 0 && (
                <tr><td colSpan={6} className="empty-state">No readings captured for this block yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'common' && (
        <div className="card">
          <h3 style={{ marginBottom: 15 }}>Common Area Readings</h3>
          <table>
            <thead>
              <tr><th>Area</th><th style={{ textAlign: 'right' }}>Start Reading</th><th style={{ textAlign: 'right' }}>End Reading</th><th style={{ textAlign: 'right' }}>Consumption (L)</th><th>Captured By</th></tr>
            </thead>
            <tbody>
              {commonReadings.map(cr => (
                <tr key={cr.id}>
                  <td>{cr.area_name}</td>
                  <td style={{ textAlign: 'right' }}>{Number(cr.start_reading).toFixed(3)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(cr.end_reading).toFixed(3)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(cr.consumption_litres).toLocaleString()}</td>
                  <td>{cr.captured_by_name || '-'}</td>
                </tr>
              ))}
              {commonReadings.length === 0 && (
                <tr><td colSpan={5} className="empty-state">No common area readings yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'billing' && (
        <div className="card">
          <div className="tabs" style={{ marginBottom: 15 }}>
            {blocks.map(b => (
              <button key={b.id} className={`tab ${activeBlock === b.id ? 'active' : ''}`}
                onClick={() => setActiveBlock(b.id)}>{b.display_name}</button>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>Flat No</th>
                <th style={{ textAlign: 'right' }}>Start</th>
                <th style={{ textAlign: 'right' }}>End</th>
                <th style={{ textAlign: 'right' }}>Consumption (L)</th>
                <th style={{ textAlign: 'right' }}>Slab1 Qty</th>
                <th style={{ textAlign: 'right' }}>Slab2 Qty</th>
                <th style={{ textAlign: 'right' }}>Slab3 Qty</th>
                <th style={{ textAlign: 'right' }}>Slab1 Cost</th>
                <th style={{ textAlign: 'right' }}>Slab2 Cost</th>
                <th style={{ textAlign: 'right' }}>Slab3 Cost</th>
                <th style={{ textAlign: 'right' }}>Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              {blockBilling.map(b => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600 }}>{b.flat_number}</td>
                  <td style={{ textAlign: 'right' }}>{Number(b.start_reading)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(b.end_reading)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(b.consumption_litres).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{Number(b.slab1_qty).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{Number(b.slab2_qty).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{Number(b.slab3_qty).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>₹{Number(b.slab1_cost).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>₹{Number(b.slab2_cost).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>₹{Number(b.slab3_cost).toFixed(2)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{Number(b.total_cost).toFixed(2)}</td>
                </tr>
              ))}
              {blockBilling.length === 0 && (
                <tr><td colSpan={11} className="empty-state">No billing data. Run calculation first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'costs' && (
        <div>
          {(user.role === 'accountant' || user.role === 'watercommittee') && record.status !== 'final' && (
            <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
              {!editingCosts ? (
                <button className="btn btn-primary" onClick={startEditCosts}>Edit Costs & Sources</button>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={saveCosts}>Save Changes</button>
                  <button className="btn btn-secondary" onClick={() => setEditingCosts(false)}>Cancel</button>
                </>
              )}
            </div>
          )}
          <div className="grid-2">
            <div className="card">
              <h3 style={{ marginBottom: 15 }}>Cost Items</h3>
              <table>
                <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Amount (₹)</th></tr></thead>
                <tbody>
                  {editingCosts ? (
                    <>
                      {editCostItems.map((ci, idx) => (
                        <tr key={idx}>
                          <td>
                            <input type="text" value={ci.itemName} onChange={e => {
                              const items = [...editCostItems];
                              items[idx].itemName = e.target.value;
                              setEditCostItems(items);
                            }} style={{ width: '100%' }} />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <input type="number" step="1" value={ci.amount} onChange={e => {
                                const items = [...editCostItems];
                                items[idx].amount = e.target.value;
                                setEditCostItems(items);
                              }} style={{ width: 120, textAlign: 'right' }} />
                              <button className="btn btn-sm btn-secondary" onClick={() => setEditCostItems(editCostItems.filter((_, i) => i !== idx))}>✕</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={2}>
                          <button className="btn btn-sm" onClick={() => setEditCostItems([...editCostItems, { itemName: '', amount: 0 }])}>+ Add Item</button>
                        </td>
                      </tr>
                    </>
                  ) : (
                    <>
                      {record.cost_items?.map(ci => (
                        <tr key={ci.id}><td>{ci.item_name}</td><td style={{ textAlign: 'right' }}>₹{Number(ci.amount).toLocaleString()}</td></tr>
                      ))}
                      {(!record.cost_items || record.cost_items.length === 0) && (
                        <tr><td colSpan={2} className="empty-state">No cost items added.</td></tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3 style={{ marginBottom: 15 }}>Water Source Readings</h3>
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th style={{ textAlign: 'right' }}>Start</th>
                    <th style={{ textAlign: 'right' }}>End/Count</th>
                    <th style={{ textAlign: 'right' }}>Cost/Unit (₹)</th>
                    <th style={{ textAlign: 'right' }}>Total Cost (₹)</th>
                    <th style={{ textAlign: 'right' }}>Consumption (L)</th>
                  </tr>
                </thead>
                <tbody>
                  {editingCosts ? (
                    editSourceReadings.map((wsr, idx) => (
                      <tr key={idx}>
                        <td>{wsr.sourceName}</td>
                        <td style={{ textAlign: 'right' }}>
                          {wsr.sourceType === 'borewell' ? (
                            <input type="number" step="1" value={wsr.startReading} onChange={e => {
                              const items = [...editSourceReadings];
                              items[idx].startReading = e.target.value;
                              setEditSourceReadings(items);
                            }} style={{ width: 100, textAlign: 'right' }} />
                          ) : '-'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {wsr.sourceType === 'borewell' ? (
                            <input type="number" step="1" value={wsr.endReading} onChange={e => {
                              const items = [...editSourceReadings];
                              items[idx].endReading = e.target.value;
                              setEditSourceReadings(items);
                            }} style={{ width: 100, textAlign: 'right' }} />
                          ) : (
                            <input type="number" step="1" value={wsr.unitCount} onChange={e => {
                              const items = [...editSourceReadings];
                              items[idx].unitCount = e.target.value;
                              setEditSourceReadings(items);
                            }} style={{ width: 80, textAlign: 'right' }} />
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {wsr.sourceType === 'tanker' ? (
                            <input type="number" step="1" value={wsr.costPerUnit} onChange={e => {
                              const items = [...editSourceReadings];
                              items[idx].costPerUnit = e.target.value;
                              setEditSourceReadings(items);
                            }} style={{ width: 100, textAlign: 'right' }} />
                          ) : '-'}
                        </td>
                        <td style={{ textAlign: 'right', color: '#666' }}>
                          {wsr.sourceType === 'tanker' ? `₹${((wsr.unitCount || 0) * (wsr.costPerUnit || 0)).toLocaleString()}` : '-'}
                        </td>
                        <td style={{ textAlign: 'right', color: '#666' }}>—</td>
                      </tr>
                    ))
                  ) : (
                    <>
                      {record.water_source_readings?.map(wsr => (
                        <tr key={wsr.id}>
                          <td>{wsr.source_name}</td>
                          <td style={{ textAlign: 'right' }}>{wsr.start_reading || '-'}</td>
                          <td style={{ textAlign: 'right' }}>{wsr.end_reading || wsr.unit_count || '-'}</td>
                          <td style={{ textAlign: 'right' }}>{wsr.source_type === 'tanker' ? `₹${Number(wsr.cost_per_unit || 0).toLocaleString()}` : '-'}</td>
                          <td style={{ textAlign: 'right' }}>{wsr.total_cost ? `₹${Number(wsr.total_cost).toLocaleString()}` : '-'}</td>
                          <td style={{ textAlign: 'right' }}>{Number(wsr.consumption_litres).toLocaleString()}</td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
