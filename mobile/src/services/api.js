import AsyncStorage from '@react-native-async-storage/async-storage';

// Change this to your server's LAN IP when running on a real device
// For Android emulator use http://10.0.2.2:3000
// For iOS simulator use http://localhost:3000
let BASE_URL = 'http://192.168.1.100:3000';

export function setBaseUrl(url) {
  BASE_URL = url;
}

export function getBaseUrl() {
  return BASE_URL;
}

async function getToken() {
  return AsyncStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    await AsyncStorage.removeItem('token');
    throw new Error('SESSION_EXPIRED');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  // Auth
  async login(username, password) {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    await AsyncStorage.setItem('token', data.token);
    await AsyncStorage.setItem('user', JSON.stringify(data.user));
    return data;
  },

  async logout() {
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('user');
  },

  async getStoredUser() {
    const userStr = await AsyncStorage.getItem('user');
    const token = await AsyncStorage.getItem('token');
    if (userStr && token) return JSON.parse(userStr);
    return null;
  },

  // Blocks & flats
  getBlocks: () => request('/api/blocks'),
  getFlats: (blockId) => request(`/api/blocks/${blockId}/flats`),

  // Monthly records
  getMonthlyRecords: () => request('/api/monthly-records'),

  // Readings
  getReadings: (recordId, blockId) => request(`/api/readings/${recordId}/block/${blockId}`),

  saveReadings: (readings) => request('/api/readings', {
    method: 'POST',
    body: JSON.stringify({ readings }),
  }),

  verifyReading: (id) => request(`/api/readings/${id}/verify`, { method: 'PUT' }),
};
