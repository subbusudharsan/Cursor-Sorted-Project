import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, Eye, EyeOff, Mail, Lock, LogIn } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import Button from '@/components/ui/Button';
import NotificationBanner from '@/components/ui/NotificationBanner';
import KeyboardSafeView from '@/components/KeyboardSafeView';

function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
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

  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  const { signIn } = useAuth();

  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => {
    setNotification({ visible: true, type, title, message });
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      showNotification('error', 'Missing Information', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      await signIn(email.trim(), password);
      showNotification('success', 'Welcome back!', 'Redirecting to your chats...');
      setTimeout(() => {
      router.replace('/(tabs)/chats');
      }, 1000);
    } catch (error: any) {
      showNotification('error', 'Sign In Failed', error.message || 'Please check your credentials and try again');
    } finally {
      setLoading(false);
    }
  };

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
        bounces={false}
        removeClippedSubviews={false}
        keyboardDismissMode="on-drag"
      >
          <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
            <View style={styles.header}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
              >
                <ArrowLeft size={24} color={Colors.text.secondary} />
              </TouchableOpacity>
              
              <View style={styles.iconContainer}>
                <View style={styles.iconBackground}>
                  <View style={styles.iconInnerCircle}>
                    <LogIn size={24} color={Colors.primary[700]} />
                  </View>
                </View>
              </View>
              
              <Text style={styles.title}>Welcome Back</Text>
              <Text style={styles.subtitle}>
                Sign in to keep growing emotionally 🌸
              </Text>
            </View>

            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <View style={styles.labelContainer}>
                  <Mail size={16} color={Colors.primary[500]} style={styles.labelIcon} />
                  <Text style={styles.label}>Email</Text>
                </View>
                <View style={[styles.inputWrapper, styles.emailInputWrapper]}>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Enter your email"
                    placeholderTextColor={Colors.text.tertiary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <View style={styles.labelContainer}>
                  <Lock size={16} color={Colors.secondary[500]} style={styles.labelIcon} />
                  <Text style={styles.label}>Password</Text>
                </View>
                <View style={[styles.inputWrapper, styles.passwordContainer, styles.passwordInputWrapper]}>
                  <TextInput
                    style={styles.passwordInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter your password"
                    placeholderTextColor={Colors.text.tertiary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff size={20} color={Colors.text.tertiary} />
                    ) : (
                      <Eye size={20} color={Colors.text.tertiary} />
                    )}
                  </TouchableOpacity>
                </View>
                <TouchableOpacity 
                  style={styles.forgotContainer}
                  onPress={() => router.push('/(auth)/forgot-password')}
                >
                  <Text style={styles.forgotLink}>Forgot password?</Text>
                </TouchableOpacity>
              </View>

              <Button
                title="Sign In"
                onPress={handleSignIn}
                loading={loading}
                disabled={loading}
                variant="primary"
                size="large"
                style={styles.signInButton}
              />

              <View style={styles.signUpContainer}>
                <Text style={styles.signUpText}>Don't have an account? </Text>
                <TouchableOpacity 
                  onPress={() => router.replace('/(auth)/signup')}
                >
                  <Text style={styles.signUpLink}>Sign Up</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: 40,
    paddingBottom: Spacing.xxxl,
  },
  content: {
    flex: 1,
  },
  header: {
    marginBottom: Spacing.xl,
    alignItems: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
    alignSelf: 'flex-start',
    ...Shadows.small,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: Spacing.sm,
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
    width: 46,
    height: 46,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primary[200],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.primary[300],
  },
  title: {
    fontSize: Typography.fontSize['3xl'],
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.base,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  form: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 2,
    borderColor: Colors.primary[100],
    ...Shadows.medium,
  },
  inputContainer: {
    marginBottom: Spacing.lg,
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  labelIcon: {
    marginRight: Spacing.xs,
  },
  label: {
    fontSize: Typography.fontSize.base,
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
  passwordInputWrapper: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.secondary[400],
    backgroundColor: Colors.secondary[50],
  },
  input: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  eyeButton: {
    padding: Spacing.sm,
  },
  signInButton: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[400],
    shadowColor: Colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  signUpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  signUpText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
  },
  signUpLink: {
    fontSize: Typography.fontSize.base,
    color: Colors.success[700],
    fontWeight: Typography.fontWeight.medium,
    marginLeft: Spacing.xs,
  },
  forgotContainer: {
    alignItems: 'flex-end',
    marginTop: Spacing.xs,
    marginBottom: 0,
  },
  forgotLink: {
    color: Colors.secondary[600],
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
  },
});

export default SignInScreen;