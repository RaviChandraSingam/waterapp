import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Alert } from 'react-native';
import { useAuth } from '../../App';
import { api } from '../services/api';

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [records, setRecords] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadRecords();
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ paddingHorizontal: 8 }}>
            <Text style={{ color: '#fff', fontSize: 16 }}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout} style={{ paddingHorizontal: 8 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Logout</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, []);

  const loadRecords = async () => {
    try {
      const data = await api.getMonthlyRecords();
      setRecords(data);
    } catch (err) {
      if (err.message === 'SESSION_EXPIRED') return;
      Alert.alert('Error', 'Could not load records');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRecords();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  const statusColor = (s) => {
    switch (s) {
      case 'draft': return '#94a3b8';
      case 'captured': return '#f59e0b';
      case 'reviewed': return '#3b82f6';
      case 'final': return '#22c55e';
      default: return '#94a3b8';
    }
  };

  const activeRecords = records.filter(r => r.status !== 'final');
  const completedRecords = records.filter(r => r.status === 'final');

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.greeting}>
        <Text style={styles.greetingText}>Welcome, {user.fullName || user.name}</Text>
        <View style={[styles.roleBadge, { backgroundColor: user.role === 'plumber' ? '#dbeafe' : '#dcfce7' }]}>
          <Text style={[styles.roleText, { color: user.role === 'plumber' ? '#2563eb' : '#16a34a' }]}>
            {user.role.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Active Periods</Text>
      {activeRecords.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No active records. Ask your admin to create a new monthly record.</Text>
        </View>
      )}
      {activeRecords.map(r => (
        <TouchableOpacity
          key={r.id}
          style={styles.card}
          onPress={() => navigation.navigate('SelectBlock', { record: r })}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{MONTH_NAMES[r.month]} {r.year}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(r.status) }]}>
              <Text style={styles.statusText}>{r.status.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.cardSub}>
            {r.period_start_date?.substring(0, 10)} → {r.period_end_date?.substring(0, 10)}
          </Text>
          <Text style={styles.cardAction}>Tap to capture readings →</Text>
        </TouchableOpacity>
      ))}

      {completedRecords.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Completed</Text>
          {completedRecords.map(r => (
            <View key={r.id} style={[styles.card, { opacity: 0.6 }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{MONTH_NAMES[r.month]} {r.year}</Text>
                <View style={[styles.statusBadge, { backgroundColor: statusColor(r.status) }]}>
                  <Text style={styles.statusText}>FINAL</Text>
                </View>
              </View>
              <Text style={styles.cardSub}>
                {r.period_start_date?.substring(0, 10)} → {r.period_end_date?.substring(0, 10)}
              </Text>
            </View>
          ))}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  greeting: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 0 },
  greetingText: { fontSize: 18, fontWeight: '600', color: '#1e293b' },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  roleText: { fontSize: 11, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#64748b', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#1e293b' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cardSub: { fontSize: 13, color: '#64748b', marginBottom: 8 },
  cardAction: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
  emptyCard: { backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 12, padding: 24, alignItems: 'center' },
  emptyText: { color: '#94a3b8', textAlign: 'center' },
});
