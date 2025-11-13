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
import KeyboardSafeView from '@/components/KeyboardSafeView';
import { router } from 'expo-router';
import { Eye, EyeOff, ArrowLeft, Lock } from 'lucide-react-native';
import NotificationBanner from '@/components/ui/NotificationBanner';
import Button from '@/components/ui/Button';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { isStrongPassword, PASSWORD_RULE_DESCRIPTION, getPasswordErrors } from '@/utils/passwordPolicy';

export default function ChangePasswordScreen() {
  const { user } = useAuth();
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
      edges={['top', 'left', 'right']}
    >
      <NotificationBanner
        {...notification}
        onDismiss={handleDismissNotification}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <ArrowLeft size={24} color={Colors.text.secondary} />
            </TouchableOpacity>
            <Lock size={36} color={Colors.primary[500]} />
            <Text style={styles.title}>Change Password</Text>
            <Text style={styles.subtitle}>Keep your account secure with a stronger password.</Text>
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
                  {showCurrentPassword ? <EyeOff size={20} color={Colors.text.tertiary} /> : <Eye size={20} color={Colors.text.tertiary} />}
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
                  {showNewPassword ? <EyeOff size={20} color={Colors.text.tertiary} /> : <Eye size={20} color={Colors.text.tertiary} />}
                </TouchableOpacity>
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
                  {showConfirmPassword ? <EyeOff size={20} color={Colors.text.tertiary} /> : <Eye size={20} color={Colors.text.tertiary} />}
                </TouchableOpacity>
              </View>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <Text style={styles.validationText}>• Passwords must match.</Text>
              )}
            </View>

            <Button
              title="Save New Password"
              onPress={handleChangePassword}
              loading={loading}
              disabled={!canSubmit}
              variant="primary"
              size="large"
            />

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
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.md,
    ...Shadows.small,
  },
  title: {
    fontSize: Typography.fontSize['2xl'],
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginTop: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  form: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    ...Shadows.medium,
  },
  field: {
    gap: Spacing.sm,
  },
  label: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surfaceElevated,
    ...Shadows.small,
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  eyeButton: {
    paddingHorizontal: Spacing.lg,
  },
  validationContainer: {
    marginTop: Spacing.sm,
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
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  loadingText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
  },
});

