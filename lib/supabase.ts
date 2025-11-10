// lib/supabase.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// ⚙️ Load environment variables safely
const getEnvVariable = (key: string): string => {
  if (process.env[key]) return process.env[key]!;
  if (Constants.expoConfig?.extra?.[key]) return Constants.expoConfig.extra[key];
  if (Constants.manifest?.extra?.[key]) return Constants.manifest.extra[key];
  if (Constants.manifest2?.extra?.expoClient?.extra?.[key])
    return Constants.manifest2.extra.expoClient.extra[key];
  return '';
};

const supabaseUrl =
  getEnvVariable('EXPO_PUBLIC_SUPABASE_URL') || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey =
  getEnvVariable('EXPO_PUBLIC_SUPABASE_ANON_KEY') || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('❌ Missing Supabase credentials.');
}

// 🧭 Detect environment
const isWeb = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

let storage: any = undefined;
if (!isWeb) {
  const { default: AsyncStorage } = require('@react-native-async-storage/async-storage');
  storage = AsyncStorage;
}

const getStorageAdapter = () => {
  if (isWeb) {
    return window.localStorage;
  }
  if (storage) {
    return {
      getItem: (key: string) => storage.getItem(key),
      setItem: (key: string, value: string) => storage.setItem(key, value),
      removeItem: (key: string) => storage.removeItem(key),
    };
  }
  return undefined;
};

// ✅ Create client safely
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getStorageAdapter(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: isWeb,
  },
  global: {
    headers: { 'X-Client-Info': 'sorted-app' },
  },
});

console.log(`✅ Supabase initialized for ${isWeb ? 'web' : 'native'}`);
