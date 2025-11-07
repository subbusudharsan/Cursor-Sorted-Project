import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// ---- Load environment vars safely ----
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

// ---- Make every tab truly independent ----
// Each tab gets a persistent random ID stored in sessionStorage.
// This ensures Supabase never shares in-memory tokens across tabs.
const tabId = (() => {
  try {
    // ✅ Works on web only
    if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
      let id = sessionStorage.getItem('sorted_tab_id');
      if (!id) {
        id = crypto.randomUUID?.() || Math.random().toString(36).substring(2, 10);
        sessionStorage.setItem('sorted_tab_id', id);
      }
      return id;
    }
    // ✅ Fallback for React Native
    return 'native-' + Math.random().toString(36).substring(2, 10);
  } catch {
    return 'native-fallback';
  }
})();

const storageKey = `sorted_supabase_auth_${tabId}`;

// ---- Create client ----
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? window.sessionStorage : AsyncStorage,
    storageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: { 'X-Client-Info': 'sorted-web' },
  },
});

console.log(`🧭 Supabase initialized using storage key: ${storageKey}`);
