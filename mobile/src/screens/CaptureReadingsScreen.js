import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { api } from '../services/api';

export default function CaptureReadingsScreen({ route, navigation }) {
  const { record, block } = route.params;
  const [flats, setFlats] = useState([]);
  const [existingReadings, setExistingReadings] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sequence, setSequence] = useState(1);
  const inputRefs = useRef({});

  useEffect(() => {
    navigation.setOptions({ title: `Block ${block.name} Readings` });
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [flatData, readingData] = await Promise.all([
        api.getFlats(block.id),
        api.getReadings(record.id, block.id),
      ]);
      setFlats(flatData);
      setExistingReadings(readingData);
      setLoading(false);
    } catch (err) {
      Alert.alert('Error', 'Could not load data');
      setLoading(false);
    }
  };

  const getExistingReading = (flatId, seq) => {
    return existingReadings.find(r => r.flat_id === flatId && r.reading_sequence === seq);
  };

  const getPreviousReading = (flatId) => {
    const flatReadings = existingReadings
      .filter(r => r.flat_id === flatId)
      .sort((a, b) => a.reading_sequence - b.reading_sequence);
    if (sequence > 1) {
      const prev = flatReadings.find(r => r.reading_sequence === sequence - 1);
      if (prev) return Number(prev.reading_value);
    }
    return flatReadings.length > 0 ? Number(flatReadings[flatReadings.length - 1].reading_value) : null;
  };

  const getWarning = (flatId, value) => {
    if (!value || value === '') return null;
    const numVal = Number(value);
    const prev = getPreviousReading(flatId);
    if (prev === null) return null;
    if (numVal < prev) return { type: 'below', msg: `Below previous (${prev})` };
    if (prev > 0 && numVal > prev * 1.5) return { type: 'high', msg: `50%+ increase from ${prev}` };
    return null;
  };

  const handleSave = async () => {
    const entries = Object.entries(values).filter(([_, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) {
      Alert.alert('No Data', 'Enter at least one reading before saving.');
      return;
    }

    const readings = entries.map(([flatId, val]) => ({
      monthlyRecordId: record.id,
      flatId,
      readingDate: new Date().toISOString().substring(0, 10),
      readingValue: Number(val),
      readingSequence: sequence,
    }));

    const warnings = readings.filter(r => {
      const w = getWarning(r.flatId, r.readingValue);
      return w !== null;
    });

    if (warnings.length > 0) {
      Alert.alert(
        'Warning',
        `${warnings.length} reading(s) have anomalies. Save anyway?`,
        [
          { text: 'Cancel' },
          { text: 'Save Anyway', onPress: () => doSave(readings) },
        ]
      );
    } else {
      doSave(readings);
    }
  };

  const doSave = async (readings) => {
    setSaving(true);
    try {
      const result = await api.saveReadings(readings);
      const warningCount = result.warnings ? result.warnings.length : 0;
      Alert.alert(
        'Saved',
        `${readings.length} reading(s) saved successfully.${warningCount > 0 ? ` ${warningCount} warning(s).` : ''}`,
        [{ text: 'OK', onPress: () => { setValues({}); loadData(); } }]
      );
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to save readings');
    } finally {
      setSaving(false);
    }
  };

  const focusNext = (currentIdx) => {
    const nextFlat = flats[currentIdx + 1];
    if (nextFlat && inputRefs.current[nextFlat.id]) {
      inputRefs.current[nextFlat.id].focus();
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View>;
  }

  const filledCount = Object.values(values).filter(v => v !== '' && v !== undefined).length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarLabel}>Reading #</Text>
        {[1, 2, 3].map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.seqButton, sequence === s && styles.seqButtonActive]}
            onPress={() => { setSequence(s); setValues({}); }}
          >
            <Text style={[styles.seqText, sequence === s && styles.seqTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <Text style={styles.counter}>{filledCount}/{flats.length}</Text>
      </View>

      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        {flats.map((flat, idx) => {
          const existing = getExistingReading(flat.id, sequence);
          const prev = getPreviousReading(flat.id);
          const warning = getWarning(flat.id, values[flat.id]);
          const isAlreadyCaptured = existing && !values[flat.id];

          return (
            <View key={flat.id} style={[styles.row, warning && styles.rowWarning]}>
              <View style={styles.flatInfo}>
                <Text style={styles.flatNumber}>{flat.flat_number}</Text>
                {prev !== null && <Text style={styles.prevReading}>Prev: {prev}</Text>}
              </View>

              {isAlreadyCaptured ? (
                <View style={styles.capturedBox}>
                  <Text style={styles.capturedValue}>{Number(existing.reading_value)}</Text>
                  <Text style={styles.capturedLabel}>Captured ✓</Text>
                </View>
              ) : (
                <TextInput
                  ref={ref => (inputRefs.current[flat.id] = ref)}
                  style={[styles.input, warning && styles.inputWarning]}
                  placeholder={existing ? String(Number(existing.reading_value)) : '—'}
                  value={values[flat.id] || ''}
                  onChangeText={v => setValues(prev => ({ ...prev, [flat.id]: v }))}
                  keyboardType="numeric"
                  returnKeyType={idx < flats.length - 1 ? 'next' : 'done'}
                  onSubmitEditing={() => focusNext(idx)}
                />
              )}

              {warning && (
                <View style={[styles.warningBadge, warning.type === 'below' ? styles.warningRed : styles.warningOrange]}>
                  <Text style={styles.warningText}>⚠</Text>
                </View>
              )}
            </View>
          );
        })}
        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={filledCount === 0}>
            <Text style={styles.saveText}>Save {filledCount} Reading{filledCount !== 1 ? 's' : ''}</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  toolbarLabel: { fontSize: 14, fontWeight: '600', color: '#64748b', marginRight: 8 },
  seqButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9',
    justifyContent: 'center', alignItems: 'center', marginHorizontal: 4,
  },
  seqButtonActive: { backgroundColor: '#2563eb' },
  seqText: { fontSize: 16, fontWeight: '600', color: '#64748b' },
  seqTextActive: { color: '#fff' },
  counter: { fontSize: 14, fontWeight: '600', color: '#2563eb' },

  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    marginHorizontal: 12, marginTop: 6, borderRadius: 10, padding: 12,
  },
  rowWarning: { borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  flatInfo: { width: 80 },
  flatNumber: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  prevReading: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  input: {
    flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    padding: 10, fontSize: 18, fontWeight: '600', textAlign: 'right', backgroundColor: '#f8fafc',
  },
  inputWarning: { borderColor: '#f59e0b', backgroundColor: '#fffbeb' },

  capturedBox: { flex: 1, alignItems: 'flex-end' },
  capturedValue: { fontSize: 18, fontWeight: '600', color: '#22c55e' },
  capturedLabel: { fontSize: 11, color: '#22c55e' },

  warningBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  warningRed: { backgroundColor: '#fef2f2' },
  warningOrange: { backgroundColor: '#fffbeb' },
  warningText: { fontSize: 14 },

  footer: {
    backgroundColor: '#2563eb', padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  saveButton: { alignItems: 'center', paddingVertical: 4 },
  saveText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
