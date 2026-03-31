import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { api } from '../services/api';

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function SelectBlockScreen({ route, navigation }) {
  const { record } = route.params;
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navigation.setOptions({ title: `${MONTH_NAMES[record.month]} ${record.year} — Select Block` });
    api.getBlocks().then(data => {
      setBlocks(data);
      setLoading(false);
    }).catch(err => {
      Alert.alert('Error', 'Could not load blocks');
      setLoading(false);
    });
  }, []);

  const blockColors = { A: '#3b82f6', B: '#22c55e', C: '#f59e0b', D: '#ef4444', E: '#8b5cf6' };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View>;
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.hint}>Select a block to capture meter readings</Text>

      {blocks.map(block => (
        <TouchableOpacity
          key={block.id}
          style={styles.blockCard}
          onPress={() => navigation.navigate('CaptureReadings', { record, block })}
        >
          <View style={[styles.blockIcon, { backgroundColor: blockColors[block.name] || '#64748b' }]}>
            <Text style={styles.blockLetter}>{block.name}</Text>
          </View>
          <View style={styles.blockInfo}>
            <Text style={styles.blockName}>{block.display_name}</Text>
            <Text style={styles.blockFlats}>{block.flat_count || '—'} flats</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hint: { fontSize: 14, color: '#64748b', textAlign: 'center', paddingVertical: 16 },
  blockCard: {
    backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  blockIcon: { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  blockLetter: { color: '#fff', fontSize: 24, fontWeight: '700' },
  blockInfo: { flex: 1, marginLeft: 16 },
  blockName: { fontSize: 18, fontWeight: '600', color: '#1e293b' },
  blockFlats: { fontSize: 13, color: '#64748b', marginTop: 2 },
  arrow: { fontSize: 28, color: '#cbd5e1', fontWeight: '300' },
});
