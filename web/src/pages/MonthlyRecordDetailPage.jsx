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
  const [pendingFile, setPendingFile] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [editingDates, setEditingDates] = useState(false);
  const [editDates, setEditDates] = useState({});

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
      await api.calculateBilling(id);
      setMessage('Recalculated and the Cost per liter and billing are updated');
      loadData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  function startEditDates() {
    setEditDates({
      periodStartDate: record.period_start_date?.split('T')[0] || '',
      periodEndDate: record.period_end_date?.split('T')[0] || '',
      midPeriodDate: record.mid_period_date?.split('T')[0] || '',
    });
    setEditingDates(true);
  }

  async function handleSaveDates() {
    try {
      await api.updateDates(id, editDates);
      setMessage('Dates updated successfully');
      setEditingDates(false);
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
      const preview = await api.previewExcel(id, file);
      setPendingFile(file);
      setUploadPreview(preview);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleConfirmUpload() {
    if (!pendingFile) return;
    setUploading(true);
    setMessage('');
    try {
      const result = await api.uploadExcel(id, pendingFile);
      setUploadStats(result.stats);
      setMessage(`Excel imported: ${result.stats.readingsImported} readings from ${result.stats.blocksProcessed} blocks`);
      setUploadPreview(null);
      setPendingFile(null);
      loadData();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="card">Loading...</div>;
  if (!record) return <div className="card">Record not found</div>;

  const blockReadings = readings.filter(r => activeBlock && r.block_name === blocks.find(b => b.id === activeBlock)?.name);
  const blockBilling = billing.filter(b => activeBlock && b.block_name === blocks.find(bl => bl.id === activeBlock)?.name);

  // Compute block totals for overview
  const blockTotals = {};
  billing.forEach(b => {
    const key = b.block_display_name || b.block_name;
    if (!blockTotals[key]) blockTotals[key] = { consumption: 0, cost: 0 };
    blockTotals[key].consumption += Number(b.consumption_litres || 0);
    blockTotals[key].cost += Number(b.total_cost || 0);
  });
  const commonUsageTotal = commonReadings.reduce((sum, cr) => sum + Number(cr.consumption_litres || 0), 0);
  const totalUsage = Object.values(blockTotals).reduce((s, b) => s + b.consumption, 0) + commonUsageTotal;

  // Separate borewell and tanker readings
  const borewellSources = (record.water_source_readings || []).filter(r => r.source_type === 'borewell');
  const tankerSources = (record.water_source_readings || []).filter(r => r.source_type === 'tanker');
  const totalWaterInput = (record.water_source_readings || []).reduce((s, r) => s + Number(r.consumption_litres || 0), 0);

  // Cost summary for overview
  const STANDARD_COST_ITEMS = ['Salt', 'E Bill 1', 'E Bill 2'];
  // Build a map by item_name (collapses any residual duplicates in display)
  const costItemsByName = {};
  (record.cost_items || []).forEach(ci => { costItemsByName[ci.item_name] = ci; });
  const extraCostItems = (record.cost_items || []).filter(ci => !STANDARD_COST_ITEMS.includes(ci.item_name))
    .filter((ci, i, arr) => arr.findIndex(x => x.item_name === ci.item_name) === i); // dedupe
  const costItemsTotal = (record.cost_items || []).reduce((s, ci) => s + Number(ci.amount || 0), 0);
  const tankerBillTotal = tankerSources.reduce((s, t) => s + Number(t.total_cost || 0), 0);
  const grandTotalCost = costItemsTotal + tankerBillTotal;

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Header row: period + workflow */}
          <div className="grid-2">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Record Details</h3>
                {!editingDates && canCalculate && (
                  <button className="btn btn-sm btn-secondary" onClick={startEditDates}>Edit Dates</button>
                )}
              </div>
              {editingDates ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.9rem' }}>
                    Start Date
                    <input type="date" className="form-control" value={editDates.periodStartDate} onChange={e => setEditDates(d => ({ ...d, periodStartDate: e.target.value }))} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.9rem' }}>
                    End Date
                    <input type="date" className="form-control" value={editDates.periodEndDate} onChange={e => setEditDates(d => ({ ...d, periodEndDate: e.target.value }))} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.9rem' }}>
                    Mid Period Date
                    <input type="date" className="form-control" value={editDates.midPeriodDate} onChange={e => setEditDates(d => ({ ...d, midPeriodDate: e.target.value }))} />
                  </label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveDates}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingDates(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <table><tbody>
                  <tr><td>Period</td><td>{record.period_start_date?.split('T')[0]} to {record.period_end_date?.split('T')[0]}</td></tr>
                  <tr><td>Mid Period</td><td>{record.mid_period_date?.split('T')[0] || '-'}</td></tr>
                  <tr><td>Status</td><td><span className={`badge badge-${record.status}`}>{record.status}</span></td></tr>
                </tbody></table>
              )}
            </div>
            <div className="card">
              <h3 style={{ marginBottom: 12 }}>Workflow</h3>
              <table><tbody>
                <tr><td>Created By</td><td>{record.created_by_name || '-'}</td></tr>
                <tr><td>Reviewed By</td><td>{record.reviewed_by_name || '-'}</td></tr>
                <tr><td>Finalized By</td><td>{record.finalized_by_name || '-'}</td></tr>
              </tbody></table>
            </div>
          </div>

          {/* Water Input */}
          <div className="card">
            <h3 style={{ marginBottom: 12, color: '#1a6eb5' }}>WATER INPUT</h3>
            <table>
              <thead>
                <tr style={{ background: '#e8f0fe' }}>
                  <th>Source</th>
                  <th style={{ textAlign: 'right' }}>Start Reading / Capacity</th>
                  <th style={{ textAlign: 'right' }}>End Reading / Count</th>
                  <th style={{ textAlign: 'right' }}>Consumption (L)</th>
                </tr>
              </thead>
              <tbody>
                {borewellSources.map(ws => (
                  <tr key={ws.id}>
                    <td>{ws.source_name}</td>
                    <td style={{ textAlign: 'right' }}>{ws.start_reading ?? '-'}</td>
                    <td style={{ textAlign: 'right' }}>{ws.end_reading ?? '-'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(ws.consumption_litres || 0).toLocaleString()}</td>
                  </tr>
                ))}
                {tankerSources.map(ws => (
                  <tr key={ws.id}>
                    <td>{ws.source_name}</td>
                    <td style={{ textAlign: 'right' }}>{Number(ws.capacity_litres || 12000).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{ws.unit_count ?? '-'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(ws.consumption_litres || 0).toLocaleString()}</td>
                  </tr>
                ))}
                {(record.water_source_readings || []).length === 0 && (
                  <tr><td colSpan={4} className="empty-state">No water source data yet.</td></tr>
                )}
                <tr style={{ background: '#f0f7ff', fontWeight: 700 }}>
                  <td colSpan={3}>TOTAL in Ltr</td>
                  <td style={{ textAlign: 'right' }}>{totalWaterInput.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Water Usage */}
          <div className="card">
            <h3 style={{ marginBottom: 12, color: '#1a6eb5' }}>WATER USAGE</h3>
            <table>
              <thead>
                <tr style={{ background: '#e8f0fe' }}>
                  <th>Block / Area</th>
                  <th style={{ textAlign: 'right' }}>Consumption (L)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(blockTotals).sort(([a], [b]) => a.localeCompare(b)).map(([blockName, data]) => (
                  <tr key={blockName}>
                    <td>{blockName} Total</td>
                    <td style={{ textAlign: 'right' }}>{data.consumption.toLocaleString()}</td>
                  </tr>
                ))}
                {Object.keys(blockTotals).length === 0 && (
                  <tr><td colSpan={2} className="empty-state">No billing data yet. Run calculation first.</td></tr>
                )}
                <tr>
                  <td>Common Usage Total</td>
                  <td style={{ textAlign: 'right' }}>{commonUsageTotal.toLocaleString()}</td>
                </tr>
                <tr style={{ background: '#f0f7ff', fontWeight: 700 }}>
                  <td>TOTAL in Ltr</td>
                  <td style={{ textAlign: 'right' }}>{totalUsage.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Cost Summary */}
          <div className="card">
            <h3 style={{ marginBottom: 12, color: '#1a6eb5' }}>COST SUMMARY</h3>
            <table>
              <thead>
                <tr style={{ background: '#e8f0fe' }}>
                  <th>Item</th>
                  <th style={{ textAlign: 'right' }}>Cost (₹)</th>
                </tr>
              </thead>
              <tbody>
                {STANDARD_COST_ITEMS.map(name => {
                  const ci = costItemsByName[name];
                  return (
                    <tr key={name} style={{ color: ci ? undefined : '#aaa' }}>
                      <td>{name}{!ci && <span style={{ fontSize: '0.8em', marginLeft: 6, fontStyle: 'italic' }}>(not billed)</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        {ci ? Number(ci.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {extraCostItems.map(ci => (
                  <tr key={ci.id}>
                    <td>{ci.item_name}</td>
                    <td style={{ textAlign: 'right' }}>{Number(ci.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
                {tankerSources.map(ws => (
                  <tr key={ws.id}>
                    <td>{ws.source_name} bill</td>
                    <td style={{ textAlign: 'right' }}>{Number(ws.total_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
                <tr style={{ background: '#f0f7ff', fontWeight: 700 }}>
                  <td>Total Cost</td>
                  <td style={{ textAlign: 'right' }}>₹{grandTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr style={{ background: '#fff8e1' }}>
                  <td>
                    <div style={{ fontWeight: 700 }}>Cost per Litre</div>
                    <div style={{ fontSize: '0.82em', color: '#666', marginTop: 3 }}>
                      = Total Cost ÷ Total Water Input
                    </div>
                    <div style={{ fontSize: '0.82em', color: '#555', marginTop: 1, fontFamily: 'monospace' }}>
                      = ₹{grandTotalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })} ÷ {totalWaterInput.toLocaleString()} L
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.05em' }}>
                    ₹{Number(record.cost_per_litre || 0).toFixed(6)}<span style={{ fontSize: '0.8em', fontWeight: 400 }}> /L</span>
                  </td>
                </tr>
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
      {uploadPreview && (
        <UploadPreviewModal
          preview={uploadPreview}
          onConfirm={handleConfirmUpload}
          onCancel={() => { setUploadPreview(null); setPendingFile(null); }}
          confirming={uploading}
        />
      )}
    </div>
  );
}

function UploadPreviewModal({ preview, onConfirm, onCancel, confirming }) {
  const [activeTab, setActiveTab] = useState('sources');
  const [activeBlock, setActiveBlock] = useState(() => Object.keys(preview.blockReadings)[0] || null);

  const totalNewReadings = preview.stats.readingsFound;
  const existingReadings = preview.stats.existingReadings || 0;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 800, width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h2>Review Import — Excel Preview</h2>
          <button className="modal-close" onClick={onCancel} disabled={confirming}>&times;</button>
        </div>

        {existingReadings > 0 && (
          <div className="alert" style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 4, padding: '10px 14px', margin: '0 0 12px 0', fontSize: '0.93em' }}>
            ⚠️ <strong>This will overwrite {existingReadings} existing meter readings</strong> for this month. Review the data below before confirming.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, borderBottom: '1px solid #e0e0e0', paddingBottom: 8 }}>
          <button className={`tab ${activeTab === 'sources' ? 'active' : ''}`} onClick={() => setActiveTab('sources')}>Water Sources &amp; Costs</button>
          <button className={`tab ${activeTab === 'readings' ? 'active' : ''}`} onClick={() => setActiveTab('readings')}>
            Meter Readings <span style={{ background: '#1a73e8', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: '0.82em', marginLeft: 4 }}>{totalNewReadings}</span>
          </button>
          <button className={`tab ${activeTab === 'common' ? 'active' : ''}`} onClick={() => setActiveTab('common')}>Common Areas</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {activeTab === 'sources' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {preview.periods.startDate && (
                <div style={{ fontSize: '0.9em', color: '#555' }}>
                  Period: <strong>{preview.periods.startDate}</strong> → <strong>{preview.periods.endDate}</strong>
                </div>
              )}
              <table>
                <thead>
                  <tr style={{ background: '#e8f0fe' }}>
                    <th>Source</th><th>Type</th>
                    <th style={{ textAlign: 'right' }}>Start / Count</th>
                    <th style={{ textAlign: 'right' }}>End</th>
                    <th style={{ textAlign: 'right' }}>Consumption (L)</th>
                    <th style={{ textAlign: 'right' }}>Total Cost (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.waterSources.length === 0 && <tr><td colSpan={6} className="empty-state">No water source data in sheet.</td></tr>}
                  {preview.waterSources.map((ws, i) => (
                    <tr key={i}>
                      <td>{ws.name}</td>
                      <td>{ws.type}</td>
                      <td style={{ textAlign: 'right' }}>{ws.type === 'borewell' ? ws.startReading : ws.unitCount}</td>
                      <td style={{ textAlign: 'right' }}>{ws.type === 'borewell' ? ws.endReading : '-'}</td>
                      <td style={{ textAlign: 'right' }}>{Number(ws.consumptionLitres).toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{ws.totalCost != null ? `₹${Number(ws.totalCost).toLocaleString()}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.costItems.length > 0 && (
                <table>
                  <thead><tr style={{ background: '#e8f0fe' }}><th>Cost Item</th><th style={{ textAlign: 'right' }}>Amount (₹)</th></tr></thead>
                  <tbody>
                    {preview.costItems.map((ci, i) => (
                      <tr key={i}><td>{ci.name}</td><td style={{ textAlign: 'right' }}>₹{Number(ci.amount).toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'readings' && (
            <div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                {Object.keys(preview.blockReadings).map(block => (
                  <button key={block} className={`tab ${activeBlock === block ? 'active' : ''}`} onClick={() => setActiveBlock(block)}>
                    {block} <span style={{ fontSize: '0.82em', color: '#888', marginLeft: 3 }}>({preview.blockReadings[block].length})</span>
                  </button>
                ))}
              </div>
              {activeBlock && preview.blockReadings[activeBlock] && (
                <table>
                  <thead>
                    <tr style={{ background: '#e8f0fe' }}>
                      <th>Flat No</th>
                      <th style={{ textAlign: 'right' }}>Reading 1</th>
                      <th style={{ textAlign: 'right' }}>Reading 2</th>
                      <th style={{ textAlign: 'right' }}>Reading 3</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.blockReadings[activeBlock].map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{r.flatNumber}</td>
                        <td style={{ textAlign: 'right' }}>{r.reading1 ?? '-'}</td>
                        <td style={{ textAlign: 'right' }}>{r.reading2 ?? '-'}</td>
                        <td style={{ textAlign: 'right' }}>{r.reading3 ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'common' && (
            <table>
              <thead>
                <tr style={{ background: '#e8f0fe' }}>
                  <th>Area</th>
                  <th style={{ textAlign: 'right' }}>Start</th>
                  <th style={{ textAlign: 'right' }}>End</th>
                  <th style={{ textAlign: 'right' }}>Consumption (L)</th>
                </tr>
              </thead>
              <tbody>
                {preview.commonAreas.length === 0 && <tr><td colSpan={4} className="empty-state">No common area data in sheet.</td></tr>}
                {preview.commonAreas.map((ca, i) => (
                  <tr key={i}>
                    <td>{ca.name}</td>
                    <td style={{ textAlign: 'right' }}>{ca.startReading}</td>
                    <td style={{ textAlign: 'right' }}>{ca.endReading}</td>
                    <td style={{ textAlign: 'right' }}>{Number(ca.consumptionLitres).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="form-actions" style={{ marginTop: 16, borderTop: '1px solid #e0e0e0', paddingTop: 12 }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={confirming}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Importing...' : `Confirm Import (${totalNewReadings} readings)`}
          </button>
        </div>
      </div>
    </div>
  );
}
