import React, { useState, useEffect, useCallback, useRef, useMemo, startTransition } from 'react';
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
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [otpTimeRemaining, setOtpTimeRemaining] = useState<number | null>(null); // Time in seconds
  const [otpExpired, setOtpExpired] = useState(false);
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

  // ✅ FIX: Use useRef to prevent multiple session checks
  const hasCheckedSession = useRef(false);

  // ✅ FIX: Memoize showNotification to prevent re-renders
  const showNotification = useCallback((
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message?: string,
  ) => {
    startTransition(() => {
      setNotification({ visible: true, type, title, message });
    });
  }, []);

  // ✅ FIX: Memoize password change handlers to prevent TextInput re-renders
  // Don't use startTransition here as it can cause input lag and flickering
  const handleNewPasswordChange = useCallback((text: string) => {
    setNewPassword(text);
  }, []);

  const handleConfirmPasswordChange = useCallback((text: string) => {
    setConfirmPassword(text);
  }, []);

  // ✅ FIX: Memoize toggle handlers
  const toggleNewPasswordVisibility = useCallback(() => {
    setShowNewPassword(prev => !prev);
  }, []);

  const toggleConfirmPasswordVisibility = useCallback(() => {
    setShowConfirmPassword(prev => !prev);
  }, []);

  // ✅ FIX: Memoize dismiss handler
  const handleDismissNotification = useCallback(() => {
    setNotification(prev => ({ ...prev, visible: false }));
  }, []);

  // ✅ FIX: Memoize back button handler
  const handleBackToSignIn = useCallback(() => {
    router.replace('/(auth)/signin');
  }, []);

  useEffect(() => {
    // ✅ FIX: Prevent multiple session checks
    if (hasCheckedSession.current) return;
    hasCheckedSession.current = true;

    // Check if we have a session (which means token was valid)
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          // ✅ FIX: Batch state updates to prevent flickering
          startTransition(() => {
            setTokenValid(true);
            setCheckingToken(false);
            // Start 1-minute OTP reuse timer
            setOtpTimeRemaining(60);
            setOtpExpired(false);
          });
        } else {
          // Try to get session from URL hash (web) or check if token is in params
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            // Supabase automatically handles the token from URL hash on web
            // Wait a bit for Supabase to process the URL hash
            setTimeout(async () => {
              const { data: { session: newSession } } = await supabase.auth.getSession();
              // ✅ FIX: Batch state updates using startTransition to prevent flicker
              if (newSession) {
                startTransition(() => {
                  setTokenValid(true);
                  setCheckingToken(false);
                  // Start 1-minute OTP reuse timer
                  setOtpTimeRemaining(60);
                  setOtpExpired(false);
                });
              } else {
                startTransition(() => {
                  setCheckingToken(false);
                });
                // Defer notification to next tick to prevent flicker
                setTimeout(() => {
                  showNotification('error', 'Invalid Link', 'This password reset link is invalid or has expired. Please request a new one.');
                }, 100);
              }
            }, 500);
            return;
          } else {
            // For native, the token should be in the deep link
            // Supabase handles this automatically when the app opens the link
            const { data: { session: newSession } } = await supabase.auth.getSession();
            // ✅ FIX: Batch state updates and defer notification to prevent flicker
            if (newSession) {
              startTransition(() => {
                setTokenValid(true);
                setCheckingToken(false);
                // Start 1-minute OTP reuse timer
                setOtpTimeRemaining(60);
                setOtpExpired(false);
              });
            } else {
              startTransition(() => {
                setCheckingToken(false);
              });
              // Defer notification to next tick to prevent flicker
              setTimeout(() => {
                showNotification('error', 'Invalid Link', 'This password reset link is invalid or has expired. Please request a new one.');
              }, 100);
            }
          }
        }
      } catch (error: any) {
        console.error('Error checking session:', error);
        // ✅ FIX: Batch state updates using startTransition to prevent flicker
        startTransition(() => {
          setCheckingToken(false);
        });
        setTimeout(() => {
          showNotification('error', 'Error', 'Failed to verify reset link. Please try again.');
        }, 100);
      }
    };

    checkSession();
    // ✅ FIX: Remove showNotification from dependencies to prevent re-renders that cause flickering
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ FIX: Use refs for showNotification and router to prevent timer useEffect re-runs
  const showNotificationRef = useRef(showNotification);
  const routerRef = useRef(router);
  
  useEffect(() => {
    showNotificationRef.current = showNotification;
  }, [showNotification]);
  
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // ✅ OTP reuse timer: Countdown from 60 seconds when token is valid
  // Timer starts when session is verified (OTP already verified via reset link)
  useEffect(() => {
    if (!tokenValid || otpTimeRemaining === null || otpExpired || isRedirecting) return;

    if (otpTimeRemaining <= 0) {
      // Timer expired - do NOT sign out, just disable and redirect
      setOtpExpired(true);
      showNotificationRef.current('error', 'OTP Expired', 'OTP expired — please request a new reset link.');
      
      // Redirect after 2-3 seconds (not immediately, don't sign out)
      setTimeout(() => {
        routerRef.current.replace('/(auth)/signin');
      }, 2500);
      return;
    }

    const timer = setInterval(() => {
      setOtpTimeRemaining(prev => {
        if (prev === null || prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [tokenValid, otpTimeRemaining, otpExpired, isRedirecting]);

  const passwordValidation = useMemo(() => getPasswordErrors(newPassword), [newPassword]);
  const passwordValid = useMemo(() => isStrongPassword(newPassword), [newPassword]);
  const passwordsMatch = useMemo(() => newPassword === confirmPassword && confirmPassword.length > 0, [newPassword, confirmPassword]);
  const canSubmit = useMemo(() => !loading && tokenValid && passwordValid && passwordsMatch && !otpExpired, [loading, tokenValid, passwordValid, passwordsMatch, otpExpired]);

  const handleResetPassword = async () => {
    // Check if OTP has expired
    if (otpExpired || (otpTimeRemaining !== null && otpTimeRemaining <= 0)) {
      showNotification('error', 'OTP Expired', 'OTP expired — please request a new reset link.');
      return;
    }

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
        // ✅ Session expired: Show error but don't clear session (might still be valid)
        showNotification('error', 'Session Error', 'Session expired. Please request a new reset link.');
        setLoading(false);
        return;
      }

      // ✅ REQUIREMENT 1: Check if new password is same as old password
      const { data: policyData, error: policyError } = await supabase.functions.invoke('password-policy', {
        body: {
          password: newPassword,
          action_type: 'password_change',
          user_id: user.id,
        },
      });

      if (policyError) {
        // ✅ Policy validation error: Do NOT sign out, allow retry with same OTP
        showNotification('error', 'Validation Error', (policyError as Error)?.message || 'Failed to validate password policy.');
        setLoading(false);
        return;
      }
      if (policyData?.error) {
        // Check if error is about same password
        if (policyData.error.toLowerCase().includes('same') || 
            policyData.error.toLowerCase().includes('previous') ||
            policyData.error.toLowerCase().includes('old password')) {
          // ✅ Error: Do NOT sign out, allow retry with same OTP
          showNotification('error', 'Password Error', 'This password is already used');
          setLoading(false);
          return;
        }
        // ✅ Other policy errors: Do NOT sign out, allow retry
        showNotification('error', 'Password Error', policyData.error);
        setLoading(false);
        return;
      }

      // Verify we got a successful response
      if (!policyData || (policyData.ok !== true && !policyData.error)) {
        // ✅ Unexpected response: Do NOT sign out, allow retry
        showNotification('error', 'Validation Error', 'Unexpected response from password validation service. Please try again.');
        setLoading(false);
        return;
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        // Check if error is about same password
        if (updateError.message?.toLowerCase().includes('same') || 
            updateError.message?.toLowerCase().includes('previous') ||
            updateError.message?.toLowerCase().includes('old password')) {
          // ✅ Same password error: Do NOT sign out, allow retry with same OTP
          showNotification('error', 'Password Error', 'This password is already used');
          setLoading(false);
          return;
        }
        // ✅ Other update errors: Do NOT sign out, allow retry
        showNotification('error', 'Update Error', updateError.message || 'Failed to update password. Please try again.');
        setLoading(false);
        return;
      }

      // ✅ SUCCESS: Password updated successfully
      showNotification('success', 'Password Changed', 'Your password has been successfully changed. Please sign in with your new password.');

      // Mark as redirecting to prevent flicker during signOut
      setIsRedirecting(true);
      
      // Stop the OTP timer since we're redirecting
      setOtpTimeRemaining(null);

      // ✅ ONLY after successful password update: sign out, wait 400ms, then navigate
      await supabase.auth.signOut();
      
      setTimeout(() => {
        router.replace('/(auth)/signin');
      }, 400);
    } catch (error: any) {
      // ✅ Error handling: Do NOT sign out, do NOT redirect - allow retry with same OTP
      setIsRedirecting(false);
      showNotification('error', 'Reset Failed', error.message || 'Failed to reset password. Please try again.');
      setLoading(false);
      // Session remains active, user can retry with same OTP
    }
  };

  // ✅ FIX: Consolidate multiple conditional returns into one return with conditional rendering
  return (
    <KeyboardSafeView style={styles.container}>
      <NotificationBanner
        {...notification}
        onDismiss={handleDismissNotification}
      />
      {checkingToken ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary[500]} />
          <Text style={styles.loadingText}>Verifying reset link...</Text>
        </View>
      ) : !tokenValid ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleBackToSignIn}>
              <ArrowLeft size={24} color={Colors.text.secondary} />
            </TouchableOpacity>
            <Text style={styles.title}>Invalid Link</Text>
            <Text style={styles.subtitle}>This password reset link is invalid or has expired.</Text>
          </View>
          <Button
            title="Back to Sign In"
            onPress={handleBackToSignIn}
            variant="primary"
            size="large"
          />
        </ScrollView>
      ) : isRedirecting ? (
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleBackToSignIn}>
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
                  value=""
                  placeholder="Enter new password"
                  placeholderTextColor={Colors.text.tertiary}
                  secureTextEntry={true}
                  editable={false}
                />
              </View>
            </View>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={[styles.inputWrapper, styles.passwordContainer]}>
                <TextInput
                  style={styles.passwordInput}
                  value=""
                  placeholder="Confirm new password"
                  placeholderTextColor={Colors.text.tertiary}
                  secureTextEntry={true}
                  editable={false}
                />
              </View>
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleBackToSignIn}>
              <ArrowLeft size={24} color={Colors.text.secondary} />
            </TouchableOpacity>
            <Lock size={36} color={Colors.primary[500]} />
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>Enter your new password below</Text>
            {otpTimeRemaining !== null && otpTimeRemaining > 0 && !otpExpired && !isRedirecting && (
              <View style={[styles.timerContainer, otpTimeRemaining <= 10 && styles.timerContainerWarning]}>
                <Text style={[styles.timerText, otpTimeRemaining <= 10 && styles.timerTextWarning]}>
                  OTP expires in {otpTimeRemaining}s
                </Text>
              </View>
            )}
          </View>

          <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>New Password</Text>
            <View style={[styles.inputWrapper, styles.passwordContainer]}>
              <TextInput
                key="new-password-input"
                style={styles.passwordInput}
                value={newPassword}
                onChangeText={handleNewPasswordChange}
                placeholder="Enter new password"
                placeholderTextColor={Colors.text.tertiary}
                secureTextEntry={!showNewPassword}
                autoCapitalize="none"
                autoFocus={false}
                editable={!loading && tokenValid}
                keyboardType="default"
                autoCorrect={false}
                textContentType="newPassword"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={toggleNewPasswordVisibility}
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
                key="confirm-password-input"
                style={styles.passwordInput}
                value={confirmPassword}
                onChangeText={handleConfirmPasswordChange}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.text.tertiary}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                autoFocus={false}
                editable={!loading && tokenValid}
                keyboardType="default"
                autoCorrect={false}
                textContentType="newPassword"
                returnKeyType="done"
                blurOnSubmit={true}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={toggleConfirmPasswordVisibility}
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

          {otpExpired ? (
            <View style={styles.expiredContainer}>
              <Text style={styles.expiredText}>OTP expired — please request a new reset link.</Text>
            </View>
          ) : (
            <Button
              title="Reset Password"
              onPress={handleResetPassword}
              loading={loading}
              disabled={!canSubmit}
              variant="primary"
              size="large"
              style={styles.resetButton}
            />
          )}
        </View>
      </ScrollView>
      )}
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
  expiredContainer: {
    marginTop: Spacing.xl,
    padding: Spacing.lg,
    backgroundColor: Colors.error[50],
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.error[200],
    alignItems: 'center',
  },
  expiredText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.error[700],
    fontWeight: Typography.fontWeight.semibold,
    textAlign: 'center',
  },
  timerContainer: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.primary[50],
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary[200],
  },
  timerText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.semibold,
    textAlign: 'center',
  },
  timerContainerWarning: {
    backgroundColor: Colors.error[50],
    borderColor: Colors.error[300],
  },
  timerTextWarning: {
    color: Colors.error[700],
  },
});
