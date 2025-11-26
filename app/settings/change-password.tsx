import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardSafeView from '@/components/KeyboardSafeView';
import { router } from 'expo-router';
import { Eye, EyeOff, ArrowLeft, Lock } from 'lucide-react-native';
import NotificationBanner from '@/components/ui/NotificationBanner';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { isStrongPassword, PASSWORD_RULE_DESCRIPTION, getPasswordErrors } from '@/utils/passwordPolicy';

export default function ChangePasswordScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message?: string;
  }>({ visible: false, type: 'info', title: '' });

  const passwordValidation = useMemo(() => getPasswordErrors(newPassword), [newPassword]);
  const passwordValid = useMemo(() => isStrongPassword(newPassword), [newPassword]);
  const passwordsMatch = useMemo(() => newPassword === confirmPassword && confirmPassword.length > 0, [newPassword, confirmPassword]);

  // Individual password rule checks (for live indicators) - same as signup
  const passwordRules = useMemo(() => {
    const pwd = newPassword;
    return {
      length: pwd.length >= 8,
      uppercase: /[A-Z]/.test(pwd),
      number: /\d/.test(pwd),
      special: /[@$!%*?&]/.test(pwd),
    };
  }, [newPassword]);

  const allPasswordRulesPass = useMemo(() => {
    return passwordRules.length && passwordRules.uppercase && passwordRules.number && passwordRules.special;
  }, [passwordRules]);

  const canSubmit =
    !loading &&
    currentPassword.length > 0 &&
    passwordValid &&
    passwordsMatch;

  const showNotification = (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message?: string,
  ) => {
    setNotification({ visible: true, type, title, message });
  };

  const handleDismissNotification = () => {
    setNotification((prev) => ({ ...prev, visible: false }));
  };

  const handleChangePassword = async () => {
    if (!user?.email) {
      showNotification('error', 'Unavailable', 'Please sign in again before changing your password.');
      return;
    }

    if (!passwordValid) {
      showNotification('error', 'Weak Password', PASSWORD_RULE_DESCRIPTION);
      return;
    }

    if (!passwordsMatch) {
      showNotification('error', 'Mismatch', 'New password and confirm password must match.');
      return;
    }

    setLoading(true);
    try {
      const reauth = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (reauth.error) {
        throw new Error(reauth.error.message || 'Current password is incorrect.');
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

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        throw new Error(updateError.message || 'Failed to update password.');
      }

      showNotification('success', 'Password Updated', 'Password updated successfully ✅');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      showNotification('error', 'Update Failed', error.message || 'Unable to update password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardSafeView
      style={styles.container}
      contentStyle={styles.inner}
      offset={Platform.OS === 'ios' ? 64 : 0}
      edges={['left', 'right']}
    >
      <NotificationBanner
        {...notification}
        onDismiss={handleDismissNotification}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.headerContainer, { paddingTop: Math.max(insets.top + Spacing.sm, Spacing.lg) }]}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <ArrowLeft size={20} color={Colors.text.secondary} />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>Change Password</Text>
            </View>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Current Password</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Enter current password"
                  placeholderTextColor={Colors.text.tertiary}
                  secureTextEntry={!showCurrentPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowCurrentPassword((prev) => !prev)}>
                  {showCurrentPassword ? <EyeOff size={16} color={Colors.text.tertiary} /> : <Eye size={16} color={Colors.text.tertiary} />}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>New Password</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Enter new password"
                  placeholderTextColor={Colors.text.tertiary}
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowNewPassword((prev) => !prev)}>
                  {showNewPassword ? <EyeOff size={16} color={Colors.text.tertiary} /> : <Eye size={16} color={Colors.text.tertiary} />}
                </TouchableOpacity>
              </View>
              
              {/* PASSWORD RULE INDICATORS - Hide when all rules pass or password is empty */}
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
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Confirm New Password</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm new password"
                  placeholderTextColor={Colors.text.tertiary}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowConfirmPassword((prev) => !prev)}>
                  {showConfirmPassword ? <EyeOff size={16} color={Colors.text.tertiary} /> : <Eye size={16} color={Colors.text.tertiary} />}
                </TouchableOpacity>
              </View>
              
              {/* PASSWORD MATCH INDICATOR - Hide when passwords match or confirm is empty */}
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
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  (!canSubmit || loading) && styles.saveButtonDisabled
                ]}
                onPress={handleChangePassword}
                disabled={!canSubmit || loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>Save New Password</Text>
                )}
              </TouchableOpacity>
            </View>

            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={Colors.primary[500]} />
                <Text style={styles.loadingText}>Updating your password…</Text>
              </View>
            )}
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
  inner: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  headerContainer: {
    width: '100%',
    position: 'relative',
    marginBottom: Spacing.lg,
  },
  backButton: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 36,
    height: 36,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
    ...Shadows.small,
  },
  headerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  headerTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    textAlign: 'center',
  },
  form: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
    ...Shadows.small,
  },
  field: {
    gap: Spacing.xs,
  },
  label: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    ...Shadows.small,
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
  },
  eyeButton: {
    paddingHorizontal: Spacing.md,
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
    fontSize: Typography.fontSize.sm,
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
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  rulePassText: {
    color: Colors.success[600],
  },
  ruleFailText: {
    color: Colors.error[600],
  },
  buttonContainer: {
    marginTop: Spacing.sm,
    width: '100%',
    alignItems: 'center',
  },
  saveButton: {
    width: '100%',
    backgroundColor: '#42A5F5', // Sky blue
    borderWidth: 2,
    borderColor: '#FFEB3B', // Lemon yellow
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.medium,
  },
  saveButtonDisabled: {
    backgroundColor: Colors.neutral[300],
    borderColor: Colors.neutral[400],
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: '#FFFFFF', // White text
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  loadingText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
  },
});

