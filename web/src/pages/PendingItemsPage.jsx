import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useAuth } from '../App';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'in_progress', 'on_hold', 'done', 'cancelled'];
const RECURRENCE_PATTERNS = ['weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly'];

const PRIORITY_COLORS = {
  low: { bg: '#e8f5e9', text: '#388e3c', border: '#a5d6a7' },
  medium: { bg: '#fff8e1', text: '#f57c00', border: '#ffe082' },
  high: { bg: '#fce4ec', text: '#c62828', border: '#f48fb1' },
  critical: { bg: '#4a0000', text: '#ff8a80', border: '#b71c1c' },
};
const STATUS_COLORS = {
  open: '#1976d2',
  in_progress: '#f57c00',
  on_hold: '#7b1fa2',
  done: '#388e3c',
  cancelled: '#757575',
};
const STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', on_hold: 'On Hold', done: 'Done', cancelled: 'Cancelled',
};

const DEFAULT_FORM = {
  title: '', category: 'general', priority: 'medium', plannedPeriod: '',
  associatedCost: '', recurring: false, recurrencePattern: '', status: 'open',
  progressPct: 0, workedOnBy: '', description: '', notes: '', dueDate: '',
};

function PriorityBadge({ priority }) {
  const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium;
  return (
    <span style={{
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>{priority}</span>
  );
}

function StatusBadge({ status }) {
  return (
    <span style={{
      background: STATUS_COLORS[status] + '22', color: STATUS_COLORS[status],
      border: `1px solid ${STATUS_COLORS[status]}55`,
      borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600,
    }}>{STATUS_LABELS[status]}</span>
  );
}

function ProgressBar({ pct }) {
  const color = pct === 100 ? '#388e3c' : pct >= 50 ? '#f57c00' : '#1976d2';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: '#e0e0e0', borderRadius: 4, height: 8 }}>
        <div style={{ width: `${pct}%`, background: color, borderRadius: 4, height: 8, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '0.8rem', color: '#666', minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

export default function PendingItemsPage() {
  const { user } = useAuth();
  const canEdit = user.role === 'watercommittee' || user.role === 'accountant';
  const canDelete = user.role === 'watercommittee';

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Filters & sort
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRecurring, setFilterRecurring] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, cats] = await Promise.all([
        api.getPendingItems({ search, category: filterCategory, priority: filterPriority, status: filterStatus, recurring: filterRecurring, sortBy, sortDir }),
        api.getPendingItemCategories(),
      ]);
      setItems(data);
      setCategories(cats);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, filterCategory, filterPriority, filterStatus, filterRecurring, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm(DEFAULT_FORM);
    setEditItem(null);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(item) {
    setForm({
      title: item.title,
      category: item.category,
      priority: item.priority,
      plannedPeriod: item.planned_period || '',
      associatedCost: item.associated_cost || '',
      recurring: item.recurring,
      recurrencePattern: item.recurrence_pattern || '',
      status: item.status,
      progressPct: item.progress_pct,
      workedOnBy: item.worked_on_by || '',
      description: item.description || '',
      notes: item.notes || '',
      dueDate: item.due_date ? item.due_date.split('T')[0] : '',
    });
    setEditItem(item);
    setFormError('');
    setShowForm(true);
    setViewItem(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title.trim()) { setFormError('Title is required'); return; }
    setSaving(true); setFormError('');
    try {
      const payload = {
        ...form,
        associatedCost: form.associatedCost !== '' ? parseFloat(form.associatedCost) : null,
        progressPct: parseInt(form.progressPct),
        dueDate: form.dueDate || null,
        plannedPeriod: form.plannedPeriod || null,
        recurrencePattern: form.recurring ? form.recurrencePattern : null,
      };
      if (editItem) {
        await api.updatePendingItem(editItem.id, payload);
      } else {
        await api.createPendingItem(payload);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this item?')) return;
    try {
      await api.deletePendingItem(id);
      setViewItem(null);
      load();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  function SortArrow({ col }) {
    if (sortBy !== col) return <span style={{ color: '#ccc', marginLeft: 4 }}>↕</span>;
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const activeFilters = [filterCategory, filterPriority, filterStatus, filterRecurring, search].filter(Boolean).length;

  return (
    <div>
      <div className="page-header">
        <h1>📋 Pending Items</h1>
        {canEdit && <button className="btn" onClick={openCreate}>+ New Item</button>}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: 4 }}>Search</label>
            <input
              type="text" placeholder="Search title, description, notes…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: '0.9rem' }}
            />
          </div>
          <div style={{ flex: '0 1 160px' }}>
            <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: 4 }}>Category</label>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ width: '100%', padding: '7px 8px', border: '1px solid #ddd', borderRadius: 6 }}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 130px' }}>
            <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: 4 }}>Priority</label>
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ width: '100%', padding: '7px 8px', border: '1px solid #ddd', borderRadius: 6 }}>
              <option value="">All</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 140px' }}>
            <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: 4 }}>Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: '100%', padding: '7px 8px', border: '1px solid #ddd', borderRadius: 6 }}>
              <option value="">All</option>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 130px' }}>
            <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: 4 }}>Recurring</label>
            <select value={filterRecurring} onChange={e => setFilterRecurring(e.target.value)} style={{ width: '100%', padding: '7px 8px', border: '1px solid #ddd', borderRadius: 6 }}>
              <option value="">All</option>
              <option value="true">Recurring only</option>
              <option value="false">One-time only</option>
            </select>
          </div>
          <div style={{ flex: '0 1 160px' }}>
            <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: 4 }}>Sort by</label>
            <select value={`${sortBy}:${sortDir}`} onChange={e => { const [col, dir] = e.target.value.split(':'); setSortBy(col); setSortDir(dir); }} style={{ width: '100%', padding: '7px 8px', border: '1px solid #ddd', borderRadius: 6 }}>
              <option value="created_at:desc">Newest first</option>
              <option value="created_at:asc">Oldest first</option>
              <option value="priority:asc">Priority (critical first)</option>
              <option value="due_date:asc">Due date (earliest)</option>
              <option value="status:asc">Status</option>
              <option value="progress_pct:desc">Progress (most)</option>
              <option value="associated_cost:desc">Cost (highest)</option>
              <option value="title:asc">Title A–Z</option>
            </select>
          </div>
          {activeFilters > 0 && (
            <button className="btn btn-secondary" style={{ padding: '7px 14px', alignSelf: 'flex-end' }} onClick={() => {
              setSearch(''); setFilterCategory(''); setFilterPriority('');
              setFilterStatus(''); setFilterRecurring('');
            }}>
              Clear ({activeFilters})
            </button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      {!loading && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Total', val: items.length, color: '#1976d2' },
            { label: 'Open', val: items.filter(i => i.status === 'open').length, color: '#1976d2' },
            { label: 'In Progress', val: items.filter(i => i.status === 'in_progress').length, color: '#f57c00' },
            { label: 'On Hold', val: items.filter(i => i.status === 'on_hold').length, color: '#7b1fa2' },
            { label: 'Done', val: items.filter(i => i.status === 'done').length, color: '#388e3c' },
            { label: 'Critical', val: items.filter(i => i.priority === 'critical').length, color: '#c62828' },
          ].map(s => (
            <div key={s.label} style={{ background: 'white', borderRadius: 8, padding: '8px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70 }}>
              <span style={{ fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.val}</span>
              <span style={{ fontSize: '0.72rem', color: '#666' }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Items table */}
      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#666' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <span className="emoji">📋</span>
            <p>No pending items found.</p>
            {canEdit && <button className="btn" onClick={openCreate} style={{ marginTop: 12 }}>+ Add first item</button>}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                <th style={th} onClick={() => toggleSort('title')} className="sortable">Title <SortArrow col="title" /></th>
                <th style={th} onClick={() => toggleSort('priority')} className="sortable">Priority <SortArrow col="priority" /></th>
                <th style={th} onClick={() => toggleSort('status')} className="sortable">Status <SortArrow col="status" /></th>
                <th style={th} onClick={() => toggleSort('progress_pct')} className="sortable">Progress <SortArrow col="progress_pct" /></th>
                <th style={th}>Category</th>
                <th style={th}>Planned Period</th>
                <th style={th} onClick={() => toggleSort('due_date')} className="sortable">Due Date <SortArrow col="due_date" /></th>
                <th style={th} onClick={() => toggleSort('associated_cost')} className="sortable">Cost <SortArrow col="associated_cost" /></th>
                <th style={th}>Type</th>
                <th style={th}>Updated by</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #eee', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  <td style={td}>
                    <button onClick={() => setViewItem(item)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1976d2', fontWeight: 600, textAlign: 'left', padding: 0 }}>
                      {item.title}
                    </button>
                    {item.worked_on_by && <div style={{ fontSize: '0.75rem', color: '#888' }}>👤 {item.worked_on_by}</div>}
                  </td>
                  <td style={td}><PriorityBadge priority={item.priority} /></td>
                  <td style={td}><StatusBadge status={item.status} /></td>
                  <td style={{ ...td, minWidth: 120 }}><ProgressBar pct={parseInt(item.progress_pct)} /></td>
                  <td style={td}><span style={{ background: '#e3f2fd', color: '#1565c0', borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem' }}>{item.category}</span></td>
                  <td style={td}>{item.planned_period || '—'}</td>
                  <td style={td}>{item.due_date ? new Date(item.due_date).toLocaleDateString() : '—'}</td>
                  <td style={td}>{item.associated_cost ? `₹${Number(item.associated_cost).toLocaleString()}` : '—'}</td>
                  <td style={td}>{item.recurring ? <span title={item.recurrence_pattern || ''} style={{ color: '#7b1fa2' }}>🔁 {item.recurrence_pattern || 'recurring'}</span> : 'One-time'}</td>
                  <td style={{ ...td, fontSize: '0.78rem', color: '#888' }}>{item.updated_by_name || item.created_by_name || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <button className="btn btn-sm" style={{ fontSize: '0.78rem', padding: '3px 10px', marginRight: 4 }} onClick={() => openEdit(item)}>Edit</button>
                    )}
                    {canDelete && (
                      <button className="btn btn-sm" style={{ fontSize: '0.78rem', padding: '3px 10px', background: '#fff0f0', color: '#c62828', border: '1px solid #f48fb1' }} onClick={() => handleDelete(item.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* View detail modal */}
      {viewItem && (
        <div className="modal-overlay" onClick={() => setViewItem(null)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.1rem' }}>{viewItem.title}</h2>
              <button className="modal-close" onClick={() => setViewItem(null)}>&times;</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: '0.88rem' }}>
              <Detail label="Priority"><PriorityBadge priority={viewItem.priority} /></Detail>
              <Detail label="Status"><StatusBadge status={viewItem.status} /></Detail>
              <Detail label="Category"><span style={{ background: '#e3f2fd', color: '#1565c0', borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem' }}>{viewItem.category}</span></Detail>
              <Detail label="Type">{viewItem.recurring ? `🔁 ${viewItem.recurrence_pattern || 'Recurring'}` : 'One-time'}</Detail>
              <Detail label="Planned Period">{viewItem.planned_period || '—'}</Detail>
              <Detail label="Due Date">{viewItem.due_date ? new Date(viewItem.due_date).toLocaleDateString() : '—'}</Detail>
              <Detail label="Associated Cost">{viewItem.associated_cost ? `₹${Number(viewItem.associated_cost).toLocaleString()}` : '—'}</Detail>
              <Detail label="Worked on by">{viewItem.worked_on_by || '—'}</Detail>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: 4 }}>Progress</label>
                <ProgressBar pct={parseInt(viewItem.progress_pct)} />
              </div>
              {viewItem.description && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: 4 }}>Description</label>
                  <p style={{ margin: 0, color: '#333', whiteSpace: 'pre-wrap' }}>{viewItem.description}</p>
                </div>
              )}
              {viewItem.notes && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: 4 }}>Notes / Comments</label>
                  <p style={{ margin: 0, color: '#333', whiteSpace: 'pre-wrap', background: '#fffde7', padding: 10, borderRadius: 6, border: '1px solid #fff176' }}>{viewItem.notes}</p>
                </div>
              )}
              <Detail label="Created by">{viewItem.created_by_name || '—'}</Detail>
              <Detail label="Last updated by">{viewItem.updated_by_name || '—'}</Detail>
              <Detail label="Created">{new Date(viewItem.created_at).toLocaleString()}</Detail>
              <Detail label="Last updated">{new Date(viewItem.updated_at).toLocaleString()}</Detail>
              {viewItem.completed_at && <Detail label="Completed">{new Date(viewItem.completed_at).toLocaleString()}</Detail>}
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {canEdit && <button className="btn" onClick={() => openEdit(viewItem)}>Edit</button>}
              {canDelete && <button className="btn" style={{ background: '#fff0f0', color: '#c62828', border: '1px solid #f48fb1' }} onClick={() => handleDelete(viewItem.id)}>Delete</button>}
              <button className="btn btn-secondary" onClick={() => setViewItem(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2>{editItem ? 'Edit Item' : 'New Pending Item'}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>&times;</button>
            </div>
            <form onSubmit={handleSave}>
              {formError && <div className="alert alert-error">{formError}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Title *</label>
                  <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus required />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <input list="cat-list" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. maintenance, finance…" />
                  <datalist id="cat-list">
                    {categories.map(c => <option key={c} value={c} />)}
                    {['maintenance', 'finance', 'legal', 'infrastructure', 'general'].map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="form-group">
                  <label>Priority</label>
                  <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Progress ({form.progressPct}%)</label>
                  <input type="range" min={0} max={100} step={5} value={form.progressPct} onChange={e => setForm({ ...form, progressPct: parseInt(e.target.value) })} style={{ width: '100%' }} />
                </div>
                <div className="form-group">
                  <label>Planned Period</label>
                  <input value={form.plannedPeriod} onChange={e => setForm({ ...form, plannedPeriod: e.target.value })} placeholder="e.g. Jan 2025, Q1 2025" />
                </div>
                <div className="form-group">
                  <label>Due Date</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Associated Cost (₹)</label>
                  <input type="number" min={0} step="0.01" value={form.associatedCost} onChange={e => setForm({ ...form, associatedCost: e.target.value })} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label>Worked on by</label>
                  <input value={form.workedOnBy} onChange={e => setForm({ ...form, workedOnBy: e.target.value })} placeholder="Name or team" />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.recurring} onChange={e => setForm({ ...form, recurring: e.target.checked, recurrencePattern: '' })} />
                    <span>Recurring activity</span>
                  </label>
                </div>
                {form.recurring && (
                  <div className="form-group">
                    <label>Recurrence Pattern</label>
                    <select value={form.recurrencePattern} onChange={e => setForm({ ...form, recurrencePattern: e.target.value })}>
                      <option value="">Select…</option>
                      {RECURRENCE_PATTERNS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                  </div>
                )}
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Description</label>
                  <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What needs to be done…" style={{ width: '100%', resize: 'vertical' }} />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Notes / Comments</label>
                  <textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional context, blockers, updates…" style={{ width: '100%', resize: 'vertical' }} />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update Item' : 'Create Item'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: 2 }}>{label}</label>
      <div style={{ fontWeight: 500 }}>{children}</div>
    </div>
  );
}

const th = {
  padding: '10px 12px', fontWeight: 600, fontSize: '0.8rem', color: '#555',
  borderBottom: '2px solid #e0e0e0', whiteSpace: 'nowrap', cursor: 'pointer',
};
const td = { padding: '10px 12px', verticalAlign: 'middle' };
