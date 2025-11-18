import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Eye, EyeOff, Lock } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import Button from '@/components/ui/Button';
import NotificationBanner from '@/components/ui/NotificationBanner';
import KeyboardSafeView from '@/components/KeyboardSafeView';
import { isStrongPassword, PASSWORD_RULE_DESCRIPTION, getPasswordErrors } from '@/utils/passwordPolicy';

export default function ResetPasswordScreen() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [notification, setNotification] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message?: string;
  }>({
    visible: false,
    type: 'info',
    title: '',
  });

  useEffect(() => {
    // Check if we have a session (which means token was valid)
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setTokenValid(true);
        } else {
          // Try to get session from URL hash (web) or check if token is in params
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            // Supabase automatically handles the token from URL hash on web
            // Wait a bit for Supabase to process the URL hash
            setTimeout(async () => {
              const { data: { session: newSession } } = await supabase.auth.getSession();
              if (newSession) {
                setTokenValid(true);
              } else {
                showNotification('error', 'Invalid Link', 'This password reset link is invalid or has expired. Please request a new one.');
              }
              setCheckingToken(false);
            }, 500);
            return;
          } else {
            // For native, the token should be in the deep link
            // Supabase handles this automatically when the app opens the link
            const { data: { session: newSession } } = await supabase.auth.getSession();
            if (newSession) {
              setTokenValid(true);
            } else {
              showNotification('error', 'Invalid Link', 'This password reset link is invalid or has expired. Please request a new one.');
            }
          }
        }
      } catch (error: any) {
        console.error('Error checking session:', error);
        showNotification('error', 'Error', 'Failed to verify reset link. Please try again.');
      } finally {
        if (Platform.OS !== 'web') {
          setCheckingToken(false);
        }
      }
    };

    checkSession();
  }, []);

  const showNotification = (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message?: string,
  ) => {
    setNotification({ visible: true, type, title, message });
  };

  const passwordValidation = getPasswordErrors(newPassword);
  const passwordValid = isStrongPassword(newPassword);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  const canSubmit = !loading && tokenValid && passwordValid && passwordsMatch;

  const handleResetPassword = async () => {
    if (!passwordValid) {
      showNotification('error', 'Weak Password', PASSWORD_RULE_DESCRIPTION);
      return;
    }

    if (!passwordsMatch) {
      showNotification('error', 'Password Mismatch', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // Validate password policy
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Session expired. Please request a new reset link.');
      }

      const { data: policyData, error: policyError } = await supabase.functions.invoke('password-policy', {
        body: {
          password: newPassword,
          action_type: 'password_change',
          user_id: user.id,
        },
      });

      if (policyError) {
        throw new Error((policyError as Error)?.message || 'Failed to validate password policy.');
      }
      if (policyData?.error) {
        throw new Error(policyData.error);
      }

      // Verify we got a successful response
      if (!policyData || (policyData.ok !== true && !policyData.error)) {
        throw new Error('Unexpected response from password validation service.');
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        throw new Error(updateError.message || 'Failed to update password.');
      }

      showNotification('success', 'Password Reset!', 'Your password has been successfully reset. Redirecting to sign in...');
      setTimeout(() => {
        // Sign out to clear the reset session, then navigate to sign in
        supabase.auth.signOut().then(() => {
          router.replace('/(auth)/signin');
        });
      }, 2000);
    } catch (error: any) {
      showNotification('error', 'Reset Failed', error.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingToken) {
    return (
      <KeyboardSafeView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary[500]} />
          <Text style={styles.loadingText}>Verifying reset link...</Text>
        </View>
      </KeyboardSafeView>
    );
  }

  if (!tokenValid) {
    return (
      <KeyboardSafeView style={styles.container}>
        <NotificationBanner
          {...notification}
          onDismiss={() => setNotification(prev => ({ ...prev, visible: false }))}
        />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/(auth)/signin')}>
              <ArrowLeft size={24} color={Colors.text.secondary} />
            </TouchableOpacity>
            <Text style={styles.title}>Invalid Link</Text>
            <Text style={styles.subtitle}>This password reset link is invalid or has expired.</Text>
          </View>
          <Button
            title="Back to Sign In"
            onPress={() => router.replace('/(auth)/signin')}
            variant="primary"
            size="large"
          />
        </ScrollView>
      </KeyboardSafeView>
    );
  }

  return (
    <KeyboardSafeView style={styles.container}>
      <NotificationBanner
        {...notification}
        onDismiss={() => setNotification(prev => ({ ...prev, visible: false }))}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/(auth)/signin')}>
            <ArrowLeft size={24} color={Colors.text.secondary} />
          </TouchableOpacity>
          <Lock size={36} color={Colors.primary[500]} />
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>Enter your new password below</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>New Password</Text>
            <View style={[styles.inputWrapper, styles.passwordContainer]}>
              <TextInput
                style={styles.passwordInput}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Enter new password"
                placeholderTextColor={Colors.text.tertiary}
                secureTextEntry={!showNewPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowNewPassword(!showNewPassword)}
              >
                {showNewPassword ? (
                  <EyeOff size={20} color={Colors.text.tertiary} />
                ) : (
                  <Eye size={20} color={Colors.text.tertiary} />
                )}
              </TouchableOpacity>
            </View>
          </View>
          {!passwordValid && newPassword.length > 0 && (
            <View style={styles.validationContainer}>
              {passwordValidation.map((error) => (
                <Text key={error} style={styles.validationText}>
                  • {error}
                </Text>
              ))}
            </View>
          )}
          {newPassword.length === 0 && (
            <Text style={styles.policyHint}>{PASSWORD_RULE_DESCRIPTION}</Text>
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={[styles.inputWrapper, styles.passwordContainer]}>
              <TextInput
                style={styles.passwordInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.text.tertiary}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? (
                  <EyeOff size={20} color={Colors.text.tertiary} />
                ) : (
                  <Eye size={20} color={Colors.text.tertiary} />
                )}
              </TouchableOpacity>
            </View>
          </View>
          {confirmPassword.length > 0 && !passwordsMatch && (
            <Text style={styles.validationText}>• Passwords must match.</Text>
          )}

          <Button
            title="Reset Password"
            onPress={handleResetPassword}
            loading={loading}
            disabled={!canSubmit}
            variant="primary"
            size="large"
            style={styles.resetButton}
          />
        </View>
      </ScrollView>
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: 60,
    paddingBottom: Spacing.xxxl,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: 60,
    paddingBottom: Spacing.xxxl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xxxl * 2,
  },
  backButton: {
    alignSelf: 'flex-start',
    width: 44,
    height: 44,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
    ...Shadows.small,
  },
  title: {
    fontSize: Typography.fontSize['3xl'],
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.fontSize.lg,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
  form: {
    flex: 1,
  },
  inputContainer: {
    marginBottom: Spacing.xl,
  },
  label: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  inputWrapper: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    ...Shadows.small,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  eyeButton: {
    padding: Spacing.lg,
  },
  validationContainer: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    paddingLeft: Spacing.sm,
  },
  validationText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.error[600],
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  policyHint: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    marginTop: Spacing.sm,
  },
  resetButton: {
    marginTop: Spacing.xl,
  },
});



