import { useEffect, useState } from 'react';
import { InteractionManager, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { SafeAreaProvider } from 'react-native-safe-area-context';

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync();
}

// ✅ Load Reanimated only on native
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('react-native-reanimated');
}

/**
 * 🧠 WebFocusRefresher
 * Remounts navigation when the browser tab regains focus.
 */
function WebFocusRefresher() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const onWake = () => {
      if (document.visibilityState === 'visible') {
        Promise.resolve().then(() => {
          requestAnimationFrame(() => setTick((t) => t + 1));
        });
      }
    };

    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('pageshow', onWake);

    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('pageshow', onWake);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const evt = new CustomEvent('app:resume', { detail: { tick } });
    window.dispatchEvent(evt);
  }, [tick]);

  // ✅ Render only on web — RN ignores <div> tags safely
  return Platform.OS === 'web' ? (
    <div data-web-focus-refresher={tick} style={{ display: 'none' }} />
  ) : (
    <View />
  );
}

function RootLayout() {
  useFrameworkReady();
  const [stackKey, setStackKey] = useState(0);
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS === 'web') {
      setAppReady(true);
      return () => {
        cancelled = true;
      };
    }

    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) {
        setAppReady(true);
      }
    });
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      // ✅ Hide splash as soon as component mounts
      SplashScreen.hideAsync();
    }
  }, []);
  

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = () => setStackKey((k) => k + 1);
    window.addEventListener('app:resume', handler as EventListener);
    return () => window.removeEventListener('app:resume', handler as EventListener);
  }, []);

  // ✅ Only add document listeners after mount (web only)
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target && target.tagName === 'A') e.stopPropagation();
      };
      document.addEventListener('click', onClick);
      return () => document.removeEventListener('click', onClick);
    }
  }, []);

  if (!appReady) {
    // 👇 Show lightweight fallback instantly
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
        <StatusBar style="auto" />
      </View>
    );
  }
  

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <NotificationProvider>
            <WebFocusRefresher />
            <Stack key={`stack-${stackKey}`} screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="+not-found" />
            </Stack>
            <StatusBar style="auto" />
          </NotificationProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default RootLayout;
