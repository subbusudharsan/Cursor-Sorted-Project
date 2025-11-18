import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const handleSend = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert('Missing email', 'Please enter your email address.');
      return;
    }
    setLoading(true);
    try {
      // Get the redirect URL - for web, use current origin; for native, use deep link
      const redirectUrl = Platform.OS === 'web' 
        ? `${typeof window !== 'undefined' ? window.location.origin : ''}/(auth)/reset-password`
        : 'sorted://reset-password';
      
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: redirectUrl,
      });
      if (error) throw error;
      Alert.alert('Check your inbox', 'If an account exists for this address, a reset link has been sent.');
      router.push({ pathname: '/(auth)/enter-otp', params: { email: trimmed } });
    } catch (err: any) {
      Alert.alert('Could not send reset email', err?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>Enter your email and we’ll send you a reset link.</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={Colors.text.tertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
              />
            </View>
          </View>

          <TouchableOpacity style={[styles.primaryBtn, loading && styles.btnDisabled]} onPress={handleSend} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send reset email</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flexGrow: 1, padding: Spacing.xl, justifyContent: 'center' },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, padding: Spacing.xl, ...Shadows.small },
  title: { fontSize: Typography.fontSize['2xl'], fontWeight: Typography.fontWeight.bold, color: Colors.text.primary, marginBottom: 8 },
  subtitle: { fontSize: Typography.fontSize.base, color: Colors.text.secondary, marginBottom: Spacing.lg },
  inputGroup: { marginBottom: Spacing.xl },
  label: { fontSize: Typography.fontSize.base, fontWeight: Typography.fontWeight.semibold, color: Colors.text.primary, marginBottom: Spacing.sm },
  inputWrapper: { borderWidth: 1, borderColor: Colors.borderLight, borderRadius: BorderRadius.lg, backgroundColor: Colors.surface, ...Shadows.small },
  input: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg, fontSize: Typography.fontSize.base, color: Colors.text.primary },
  primaryBtn: { backgroundColor: Colors.primary[500], paddingVertical: Spacing.md, borderRadius: 999, alignItems: 'center', marginBottom: Spacing.md },
  btnDisabled: { opacity: 0.6 },
  primaryText: { color: '#fff', fontWeight: Typography.fontWeight.bold },
  secondaryBtn: { paddingVertical: Spacing.md, alignItems: 'center' },
  secondaryText: { color: Colors.text.secondary, fontWeight: Typography.fontWeight.semibold },
});


