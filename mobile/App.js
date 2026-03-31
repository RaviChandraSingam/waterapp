import React, { createContext, useContext, useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { api } from './src/services/api';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import SelectBlockScreen from './src/screens/SelectBlockScreen';
import CaptureReadingsScreen from './src/screens/CaptureReadingsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStoredUser().then(u => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const login = async (username, password) => {
    const data = await api.login(username, password);
    setUser(data.user);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f4f8' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#2563eb' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '600' },
          }}
        >
          {!user ? (
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'WaterApp' }} />
              <Stack.Screen name="SelectBlock" component={SelectBlockScreen} options={{ title: 'Select Block' }} />
              <Stack.Screen name="CaptureReadings" component={CaptureReadingsScreen} options={{ title: 'Capture Readings' }} />
              <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </AuthContext.Provider>
  );
}
