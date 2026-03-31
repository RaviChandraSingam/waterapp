import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../../App';
import { setBaseUrl, getBaseUrl } from '../services/api';

export default function SettingsScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [serverUrl, setServerUrl] = useState(getBaseUrl());

  const handleSaveUrl = () => {
    if (!serverUrl.startsWith('http')) {
      Alert.alert('Invalid URL', 'URL must start with http:// or https://');
      return;
    }
    setBaseUrl(serverUrl.replace(/\/$/, ''));
    Alert.alert('Saved', 'Server URL updated. Restart the app for full effect.');
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Username</Text>
          <Text style={styles.value}>{user.username}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{user.fullName || user.name}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Role</Text>
          <Text style={styles.value}>{user.role}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Server Configuration</Text>
        <Text style={styles.hint}>Set this to your backend server's address (LAN IP or hostname with port).</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://192.168.1.100:3000"
        />
        <TouchableOpacity style={styles.button} onPress={handleSaveUrl}>
          <Text style={styles.buttonText}>Save URL</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={() => {
        Alert.alert('Logout', 'Are you sure?', [
          { text: 'Cancel' },
          { text: 'Logout', style: 'destructive', onPress: logout },
        ]);
      }}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  label: { fontSize: 14, color: '#64748b' },
  value: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  hint: { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 14, backgroundColor: '#f8fafc', marginBottom: 12 },
  button: { backgroundColor: '#2563eb', borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  logoutButton: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#fecaca' },
  logoutText: { color: '#ef4444', fontWeight: '600', fontSize: 16 },
});
