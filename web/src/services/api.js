const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }

  if (res.headers.get('content-type')?.includes('application/json')) {
    return res.json();
  }
  return res;
}

export const api = {
  // Auth
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  getMe: () => request('/auth/me'),
  getUsers: () => request('/auth/users'),
  createUser: (data) => request('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  changePassword: (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  resetUserPassword: (userId, newPassword) => request(`/auth/users/${userId}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) }),
  updateUserPermissions: (userId, canManageUsers) => request(`/auth/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify({ canManageUsers }) }),
  updateUserName: (userId, fullName) => request(`/auth/users/${userId}/name`, { method: 'PUT', body: JSON.stringify({ fullName }) }),

  // Blocks & Flats
  getBlocks: () => request('/blocks'),
  getBlockFlats: (blockId) => request(`/blocks/${blockId}/flats`),
  getAllFlats: () => request('/blocks/all/flats'),

  // Monthly Records
  getMonthlyRecords: () => request('/monthly-records'),
  getMonthlyRecord: (id) => request(`/monthly-records/${id}`),
  createMonthlyRecord: (data) => request('/monthly-records', { method: 'POST', body: JSON.stringify(data) }),
  updateStatus: (id, status) => request(`/monthly-records/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  updateCostItems: (id, costItems) => request(`/monthly-records/${id}/cost-items`, { method: 'PUT', body: JSON.stringify({ costItems }) }),
  updateWaterSources: (id, readings) => request(`/monthly-records/${id}/water-sources`, { method: 'PUT', body: JSON.stringify({ readings }) }),
  calculateBilling: (id) => request(`/monthly-records/${id}/calculate`, { method: 'POST' }),

  // Readings
  getReadings: (monthlyRecordId) => request(`/readings/${monthlyRecordId}`),
  getBlockReadings: (monthlyRecordId, blockId) => request(`/readings/${monthlyRecordId}/block/${blockId}`),
  captureReadings: (readings) => request('/readings', { method: 'POST', body: JSON.stringify({ readings }) }),
  updateReading: (id, data) => request(`/readings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  verifyReading: (id) => request(`/readings/${id}/verify`, { method: 'PUT' }),
  getReadingAudit: (monthlyRecordId) => request(`/readings/audit/${monthlyRecordId}`),
  getPreviousReadings: (monthlyRecordId, blockId) => request(`/readings/${monthlyRecordId}/block/${blockId}/previous`),

  // Common Areas
  getCommonAreas: () => request('/common-areas'),
  getCommonAreaReadings: (monthlyRecordId) => request(`/common-areas/readings/${monthlyRecordId}`),
  captureCommonAreaReadings: (readings) => request('/common-areas/readings', { method: 'POST', body: JSON.stringify({ readings }) }),

  // Billing
  getBilling: (monthlyRecordId) => request(`/billing/${monthlyRecordId}`),
  getBlockBilling: (monthlyRecordId, blockId) => request(`/billing/${monthlyRecordId}/block/${blockId}`),

  // Config
  getConfig: () => request('/config'),
  updateConfig: (key, value) => request(`/config/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  getWaterSources: () => request('/config/water-sources'),

  // Dashboard
  getDashboardSummary: () => request('/dashboard/summary'),
  getConsumptionTrend: () => request('/dashboard/consumption-trend'),
  getBlockConsumption: (monthlyRecordId) => request(`/dashboard/block-consumption/${monthlyRecordId}`),

  // Pending Items
  getPendingItems: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v !== undefined && v !== '')).toString();
    return request(`/pending-items${qs ? '?' + qs : ''}`);
  },
  getPendingItemCategories: () => request('/pending-items/categories'),
  getPendingItem: (id) => request(`/pending-items/${id}`),
  createPendingItem: (data) => request('/pending-items', { method: 'POST', body: JSON.stringify(data) }),
  updatePendingItem: (id, data) => request(`/pending-items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePendingItem: (id) => request(`/pending-items/${id}`, { method: 'DELETE' }),

  // Chat / AI assistant
  chat: (message, history = []) => request('/chat', { method: 'POST', body: JSON.stringify({ message, history }) }),

  // Analytics
  trackPage: (page) => request('/analytics/track', { method: 'POST', body: JSON.stringify({ page }) }),
  getAnalyticsSummary: () => request('/analytics/summary'),

  // Export
  exportExcel: async (monthlyRecordId) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/export/${monthlyRecordId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'export.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  },

  exportBillingCSV: async (monthlyRecordId) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/export/${monthlyRecordId}/billing-csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('CSV export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'billing.csv';
    a.click();
    URL.revokeObjectURL(url);
  },

  previewExcel: async (monthlyRecordId, file) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/upload/${monthlyRecordId}/preview`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Preview failed' }));
      throw new Error(err.error || 'Preview failed');
    }
    return res.json();
  },

  uploadExcel: async (monthlyRecordId, file) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/upload/${monthlyRecordId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },
};
