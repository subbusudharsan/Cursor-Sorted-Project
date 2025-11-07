import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import Button from '@/components/ui/Button';
import NotificationBanner from '@/components/ui/NotificationBanner';

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
    <>
      <NotificationBanner
        {...notification}
        onDismiss={() => setNotification(prev => ({ ...prev, visible: false }))}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
            <View style={styles.header}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
              >
                <ArrowLeft size={24} color={Colors.text.secondary} />
              </TouchableOpacity>
              <Text style={styles.title}>Welcome Back</Text>
              <Text style={styles.subtitle}>
                Sign in to continue your emotional wellness journey
              </Text>
            </View>

            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Email</Text>
                <View style={styles.inputWrapper}>
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
                <Text style={styles.label}>Password</Text>
                <View style={[styles.inputWrapper, styles.passwordContainer]}>
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
                <TouchableOpacity onPress={() => router.replace('/(auth)/signup')}>
                  <Text style={styles.signUpLink}>Sign Up</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
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
    paddingTop: 60,
    paddingBottom: Spacing.xxxl,
  },
  content: {
    flex: 1,
  },
  header: {
    marginBottom: Spacing.xxxl * 2,
  },
  backButton: {
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
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.fontSize.lg,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.lg,
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
  input: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
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
    paddingVertical: Spacing.lg,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  eyeButton: {
    padding: Spacing.lg,
  },
  signInButton: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  signUpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signUpText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
  },
  signUpLink: {
    fontSize: Typography.fontSize.base,
    color: Colors.primary[500],
    fontWeight: Typography.fontWeight.semibold,
  },
});

export default SignInScreen;