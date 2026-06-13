import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function ConfigPage() {
  const [billingConfig, setBillingConfig] = useState([]);
  const [waterSources, setWaterSources] = useState([]);
  const [commonAreas, setCommonAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null);
  const [editCommonArea, setEditCommonArea] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [config, sources, areas] = await Promise.all([api.getConfig(), api.getWaterSources(), api.getCommonAreas()]);
    setBillingConfig(config);
    setWaterSources(sources);
    setCommonAreas(areas);
    setLoading(false);
  }

  async function handleSave(item) {
    try {
      await api.updateConfig(item.config_key, item.value);
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(''), 2000);
      setEditItem(null);
      load();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  }

  async function handleSaveCommonArea(area) {
    try {
      if (!area.name || !area.name.trim()) {
        return alert('Common area name is required');
      }

      if (area.id) {
        await api.updateCommonArea(area.id, {
          name: area.name.trim(),
          description: area.description,
          isActive: area.is_active,
        });
      } else {
        await api.createCommonArea({
          name: area.name.trim(),
          description: area.description,
          isActive: area.is_active !== false,
        });
      }
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(''), 2000);
      setEditCommonArea(null);
      load();
    } catch (err) {
      alert('Failed to save common area: ' + err.message);
    }
  }

  if (loading) return <div className="card">Loading...</div>;

  const formatLabel = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div>
      <div className="page-header">
        <h1>Configuration</h1>
        {saveMsg && <span className="badge badge-success">{saveMsg}</span>}
      </div>

      <div className="card">
        <h2>Billing Configuration</h2>
        <p style={{ color: '#666', marginBottom: 16 }}>
          These parameters control how water bills are calculated for all blocks.
        </p>
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
              <th>Description</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {billingConfig.map(item => (
              <tr key={item.id}>
                <td style={{ fontWeight: 600 }}>{formatLabel(item.config_key)}</td>
                <td>
                  {editItem?.id === item.id ? (
                    <input
                      type="text"
                      value={editItem.value}
                      onChange={e => setEditItem({ ...editItem, value: e.target.value })}
                      style={{ width: 120 }}
                      autoFocus
                    />
                  ) : (
                    <span>{item.config_value}</span>
                  )}
                </td>
                <td style={{ color: '#666' }}>{item.description || '—'}</td>
                <td>
                  {editItem?.id === item.id ? (
                    <>
                      <button className="btn btn-sm" onClick={() => handleSave(editItem)}>Save</button>{' '}
                      <button className="btn btn-sm btn-secondary" onClick={() => setEditItem(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditItem({ ...item, value: item.config_value })}>Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Slab Billing Explanation</h2>
        <div style={{ padding: '12px 0', lineHeight: 1.8 }}>
          <p><strong>Cost per litre</strong> = (Salt + E-Bill + Tanker Bills) ÷ Total Water Input</p>
          <table>
            <thead>
              <tr><th>Slab</th><th>Range</th><th>Rate</th></tr>
            </thead>
            <tbody>
              <tr><td>Slab 1</td><td>0 – Slab 1 Limit</td><td>Cost per litre × 1.0</td></tr>
              <tr><td>Slab 2</td><td>Slab 1 Limit – Slab 2 Limit</td><td>Cost per litre × Slab 2 Multiplier</td></tr>
              <tr><td>Slab 3</td><td>Above Slab 2 Limit</td><td>Cost per litre × Slab 3 Multiplier</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Water Sources</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {waterSources.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td>{s.source_type}</td>
                <td>
                  <span className={`badge ${s.is_active ? 'badge-success' : 'badge-secondary'}`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
          <h2>Common Areas</h2>
          <button className="btn btn-sm btn-primary" onClick={() => setEditCommonArea({ name: '', description: '', is_active: true })}>
            + Add Common Area
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Status</th>
              <th style={{ width: 180 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {commonAreas.map(area => (
              editCommonArea?.id === area.id ? (
                <tr key={area.id}>
                  <td>
                    <input
                      type="text"
                      value={editCommonArea.name}
                      onChange={e => setEditCommonArea({ ...editCommonArea, name: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={editCommonArea.description || ''}
                      onChange={e => setEditCommonArea({ ...editCommonArea, description: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <select
                      value={editCommonArea.is_active ? 'active' : 'inactive'}
                      onChange={e => setEditCommonArea({ ...editCommonArea, is_active: e.target.value === 'active' })}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => handleSaveCommonArea(editCommonArea)}>Save</button>{' '}
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditCommonArea(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={area.id}>
                  <td style={{ fontWeight: 600 }}>{area.name}</td>
                  <td>{area.description || '—'}</td>
                  <td>
                    <span className={`badge ${area.is_active ? 'badge-success' : 'badge-secondary'}`}>
                      {area.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditCommonArea(area)}>Edit</button>
                  </td>
                </tr>
              )
            ))}
            {commonAreas.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state">No common areas defined yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
