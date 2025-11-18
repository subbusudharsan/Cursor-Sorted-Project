import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Eye, EyeOff, Lock, Mail, KeyRound } from 'lucide-react-native';
import { Colors, Spacing, BorderRadius, Shadows, Typography } from '@/constants/Colors';
import NotificationBanner from '@/components/ui/NotificationBanner';
import KeyboardSafeView from '@/components/KeyboardSafeView';
import Button from '@/components/ui/Button';
import { isStrongPassword, PASSWORD_RULE_DESCRIPTION, getPasswordErrors } from '@/utils/passwordPolicy';

export default function EnterOTPScreen() {
  const params = useLocalSearchParams();
  const emailParam = Array.isArray(params.email) ? params.email[0] : params.email;

  const [email, setEmail] = useState(emailParam || '');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [notification, setNotification] = useState({
    visible: false,
    type: 'info' as 'success' | 'error' | 'info' | 'warning',
    title: '',
    message: '',
  });

  // ✨ Smooth fade-in + slide animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  // Auto-focus OTP field
  const otpRef = useRef<TextInput>(null);
  useEffect(() => {
    if (otpRef.current) {
      setTimeout(() => otpRef.current?.focus(), 200);
    }
  }, []);

  const showNotification = (type: any, title: string, message?: string) => {
    setNotification({ visible: true, type, title, message: message || '' });
  };

  // Validation logic
  const passwordValidation = useMemo(() => getPasswordErrors(newPassword), [newPassword]);
  const passwordValid = useMemo(() => isStrongPassword(newPassword), [newPassword]);
  const passwordsMatch = useMemo(
    () => newPassword === confirmPassword && confirmPassword.length > 0,
    [newPassword, confirmPassword]
  );

  // Individual password rule checks (for live indicators)
  const passwordRules = useMemo(() => {
    const pwd = newPassword;
    return {
      length: pwd.length >= 8,
      uppercase: /[A-Z]/.test(pwd),
      number: /\d/.test(pwd),
      special: /[@$!%*?&]/.test(pwd),
    };
  }, [newPassword]);

  // Check if all password rules pass
  const allPasswordRulesPass = useMemo(() => {
    return passwordRules.length && passwordRules.uppercase && passwordRules.number && passwordRules.special;
  }, [passwordRules]);

  const canSubmit =
    !loading &&
    email.trim() &&
    otp.length === 6 &&
    passwordValid &&
    passwordsMatch;

  // OTP formatting (digits only)
  const formatOtp = (value: string) => value.replace(/\D/g, '').slice(0, 6);

  //........................................................
  //   HANDLE PASSWORD RESET
  //........................................................
  const handleResetPassword = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      showNotification('error', 'Missing Email', 'Please enter your email.');
      return;
    }
    if (otp.length !== 6) {
      showNotification('error', 'Invalid Code', 'Enter the 6-digit OTP from your email.');
      return;
    }
    if (!passwordValid) {
      showNotification('error', 'Weak Password', PASSWORD_RULE_DESCRIPTION);
      return;
    }
    if (!passwordsMatch) {
      showNotification('error', 'Mismatch', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // Step 1: verify OTP → creates temporary session
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email: trimmedEmail,
        token: otp,
        type: 'recovery',
      });
      if (verifyError) throw new Error(verifyError.message);

      // Step 2: password policy validation
      const userId = verifyData?.user?.id;
      if (!userId) throw new Error('Unable to verify reset session.');

      const { data: policyData, error: policyError } = await supabase.functions.invoke(
        'password-policy',
        {
          body: {
            password: newPassword,
            action_type: 'password_change',
            user_id: userId,
          },
        }
      );

      if (policyError) throw new Error(policyError.message);
      if (policyData?.error) throw new Error(policyData.error);

      // Step 3: update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw new Error(updateError.message);

      // Success
      showNotification(
        'success',
        'Password Reset',
        'Your password has been updated. Redirecting...'
      );

      setTimeout(() => {
        supabase.auth.signOut().then(() => {
          router.replace('/(auth)/signin');
        });
      }, 1800);
    } catch (err: any) {
      showNotification('error', 'Reset Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  //........................................................
  // RENDER UI
  //........................................................
  return (
    <KeyboardSafeView style={styles.container}>
      <NotificationBanner
        {...notification}
        onDismiss={() => setNotification(prev => ({ ...prev, visible: false }))}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
        removeClippedSubviews={false}
        keyboardDismissMode="on-drag"
      >
        <Animated.View
          style={[
            styles.card,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
          ]}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color={Colors.text.secondary} />
          </TouchableOpacity>

          <View style={styles.iconContainer}>
            <View style={styles.iconBackground}>
              <View style={styles.iconInnerCircle}>
                <Lock size={28} color={Colors.primary[700]} />
              </View>
            </View>
          </View>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code sent to your email and create a new password
          </Text>

          {/* EMAIL */}
          <View style={styles.inputGroup}>
            <View style={styles.labelContainer}>
              <Mail size={16} color={Colors.primary[500]} style={styles.labelIcon} />
              <Text style={styles.label}>Email</Text>
            </View>
            <View style={[styles.inputWrapper, styles.emailInputWrapper]}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={Colors.text.tertiary}
                style={styles.input}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!emailParam}
              />
            </View>
          </View>

          {/* OTP */}
          <View style={styles.inputGroup}>
            <View style={styles.labelContainer}>
              <KeyRound size={16} color={Colors.secondary[500]} style={styles.labelIcon} />
              <Text style={styles.label}>Verification Code</Text>
            </View>
            <View style={[styles.inputWrapper, styles.otpInputWrapper]}>
              <TextInput
                ref={otpRef}
                value={otp}
                onChangeText={(t) => {
                  const formatted = formatOtp(t);
                  setOtp(formatted);
                }}
                onFocus={() => {
                  // Position cursor at start when focused and empty
                  if (otpRef.current && otp.length === 0) {
                    // Use requestAnimationFrame instead of setTimeout for smoother execution
                    requestAnimationFrame(() => {
                      otpRef.current?.setNativeProps({ selection: { start: 0, end: 0 } });
                    });
                  }
                }}
                placeholder="000000"
                placeholderTextColor={Colors.text.tertiary}
                keyboardType="number-pad"
                maxLength={6}
                style={styles.otpInput}
              />
            </View>
            <Text style={styles.otpHint}>6-digit OTP sent to your email</Text>
          </View>

          {/* NEW PASSWORD */}
          <View style={styles.inputGroup}>
            <View style={styles.labelContainer}>
              <Lock size={16} color={Colors.success[500]} style={styles.labelIcon} />
              <Text style={styles.label}>New Password</Text>
            </View>
            <View style={[styles.inputWrapper, styles.passwordContainer, styles.passwordInputWrapper]}>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Enter new password"
                secureTextEntry={!showNewPassword}
                placeholderTextColor={Colors.text.tertiary}
                style={styles.passwordInput}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setShowNewPassword(!showNewPassword)}
                style={styles.eyeButton}
              >
                {showNewPassword ? (
                  <EyeOff size={22} color={Colors.text.tertiary} />
                ) : (
                  <Eye size={22} color={Colors.text.tertiary} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* PASSWORD RULE INDICATORS - Hide when all rules pass */}
          <View style={[styles.validationContainer, (newPassword.length === 0 || allPasswordRulesPass) && styles.validationContainerHidden]}>
            <View style={styles.ruleRow}>
              <Text style={[styles.ruleIcon, passwordRules.length ? styles.rulePass : styles.ruleFail]}>
                {passwordRules.length ? '✔️' : '❌'}
              </Text>
              <Text style={[styles.ruleText, passwordRules.length ? styles.rulePassText : styles.ruleFailText]}>
                At least 8 characters
              </Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={[styles.ruleIcon, passwordRules.uppercase ? styles.rulePass : styles.ruleFail]}>
                {passwordRules.uppercase ? '✔️' : '❌'}
              </Text>
              <Text style={[styles.ruleText, passwordRules.uppercase ? styles.rulePassText : styles.ruleFailText]}>
                One uppercase letter
              </Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={[styles.ruleIcon, passwordRules.number ? styles.rulePass : styles.ruleFail]}>
                {passwordRules.number ? '✔️' : '❌'}
              </Text>
              <Text style={[styles.ruleText, passwordRules.number ? styles.rulePassText : styles.ruleFailText]}>
                One number
              </Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={[styles.ruleIcon, passwordRules.special ? styles.rulePass : styles.ruleFail]}>
                {passwordRules.special ? '✔️' : '❌'}
              </Text>
              <Text style={[styles.ruleText, passwordRules.special ? styles.rulePassText : styles.ruleFailText]}>
                One special symbol (@ $ ! % * ? &)
              </Text>
            </View>
          </View>

          {/* CONFIRM PASSWORD */}
          <View style={styles.inputGroup}>
            <View style={styles.labelContainer}>
              <Lock size={16} color={Colors.success[500]} style={styles.labelIcon} />
              <Text style={styles.label}>Confirm Password</Text>
            </View>
            <View style={[styles.inputWrapper, styles.passwordContainer, styles.passwordInputWrapper]}>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm password"
                secureTextEntry={!showConfirmPassword}
                placeholderTextColor={Colors.text.tertiary}
                style={styles.passwordInput}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeButton}
              >
                {showConfirmPassword ? (
                  <EyeOff size={22} color={Colors.text.tertiary} />
                ) : (
                  <Eye size={22} color={Colors.text.tertiary} />
                )}
              </TouchableOpacity>
            </View>
          </View>

              {/* PASSWORD MATCH INDICATOR - Hide when passwords match */}
              <View style={[styles.matchContainer, (confirmPassword.length === 0 || passwordsMatch) && styles.matchContainerHidden]}>
            <View style={styles.ruleRow}>
              <Text style={[styles.ruleIcon, passwordsMatch ? styles.rulePass : styles.ruleFail]}>
                {passwordsMatch ? '✔️' : '❌'}
              </Text>
              <Text style={[styles.ruleText, passwordsMatch ? styles.rulePassText : styles.ruleFailText]}>
                {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
              </Text>
            </View>
          </View>

          {/* RESET BUTTON */}
          <Button
            title="Reset Password"
            onPress={handleResetPassword}
            loading={loading}
            disabled={!canSubmit}
            variant="primary"
            size="large"
            style={styles.resetButton}
          />

          {/* BACK TO SIGN IN */}
          <TouchableOpacity onPress={() => router.replace('/(auth)/signin')}>
            <Text style={styles.backToSignIn}>Back to Sign In</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </KeyboardSafeView>
  );
}

//
// STYLES
//
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContainer: {
    flexGrow: 1,
    padding: Spacing.lg,
    paddingTop: 20,
    paddingBottom: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    borderWidth: 2,
    borderColor: Colors.primary[100],
    ...Shadows.small,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  iconBackground: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: Colors.primary[400],
    ...Shadows.small,
  },
  iconInnerCircle: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primary[200],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.primary[300],
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    ...Shadows.small,
  },
  title: {
    fontSize: Typography.fontSize['2xl'],
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginTop: 0,
  },
  subtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  inputGroup: {
    marginBottom: Spacing.md,
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  labelIcon: {
    marginRight: Spacing.xs,
  },
  label: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  inputWrapper: {
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    ...Shadows.small,
  },
  emailInputWrapper: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary[300],
  },
  otpInputWrapper: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.secondary[400],
    backgroundColor: Colors.secondary[50],
  },
  passwordInputWrapper: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.success[300],
  },
  input: {
    padding: Spacing.md,
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
  },
  otpInput: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.fontSize.xl,
    fontWeight: 'bold',
    letterSpacing: 4,
    textAlign: 'left',
    color: Colors.text.primary,
  },
  otpHint: {
    marginTop: Spacing.xs,
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    padding: Spacing.md,
    fontSize: Typography.fontSize.sm,
  },
  eyeButton: {
    padding: Spacing.lg,
  },
  validationContainer: {
    marginTop: Spacing.xs,
    marginBottom: 0,
    overflow: 'hidden',
  },
  validationContainerHidden: {
    height: 0,
    marginTop: 0,
    marginBottom: 0,
    overflow: 'hidden',
  },
  matchContainer: {
    marginTop: Spacing.xs,
    marginBottom: 0,
    overflow: 'hidden',
  },
  matchContainerHidden: {
    height: 0,
    marginTop: 0,
    marginBottom: 0,
    overflow: 'hidden',
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  ruleIcon: {
    fontSize: Typography.fontSize.base,
    marginRight: Spacing.sm,
    width: 24,
  },
  rulePass: {
    color: Colors.success[600],
  },
  ruleFail: {
    color: Colors.error[600],
  },
  ruleText: {
    fontSize: Typography.fontSize.xs,
    flex: 1,
  },
  rulePassText: {
    color: Colors.success[600],
  },
  ruleFailText: {
    color: Colors.error[600],
  },
  validationText: {
    color: Colors.error[600],
    fontSize: Typography.fontSize.sm,
    marginTop: 4,
  },
  resetButton: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[400],
    shadowColor: Colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  backToSignIn: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
    textAlign: 'center',
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.semibold,
    fontSize: Typography.fontSize.sm,
  },
});
