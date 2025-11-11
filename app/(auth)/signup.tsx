import React, { useMemo, useState } from 'react';
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { COUNTRIES } from '@/constants/countries';
import { ArrowLeft, Eye, EyeOff, Calendar } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { isStrongPassword, PASSWORD_RULE_DESCRIPTION, getPasswordErrors } from '@/utils/passwordPolicy';
import Button from '@/components/ui/Button';
import NotificationBanner from '@/components/ui/NotificationBanner';

export default function SignUpScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedPhoneCountry, setSelectedPhoneCountry] = useState(COUNTRIES[0]);
  const [showPhoneCountryPicker, setShowPhoneCountryPicker] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
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

  const { signUp } = useAuth();

  const passwordValidation = useMemo(() => getPasswordErrors(password), [password]);
  const passwordValid = useMemo(() => isStrongPassword(password), [password]);
  const passwordsMatch = useMemo(() => password === confirmPassword && confirmPassword.length > 0, [password, confirmPassword]);
  const canSubmit =
    !loading &&
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    password &&
    confirmPassword &&
    passwordValid &&
    passwordsMatch;

  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => {
    setNotification({ visible: true, type, title, message });
  };

  const formatDateInput = (text: string) => {
    const digits = text.replace(/\D/g, '');
    
    if (digits.length <= 2) {
      const month = parseInt(digits);
      if (digits.length === 2 && (month < 1 || month > 12)) {
        return digits.slice(0, 1);
      }
      return digits;
    } else if (digits.length <= 4) {
      const month = digits.slice(0, 2);
      const day = digits.slice(2);
      
      if (day.length === 2) {
        const dayNum = parseInt(day);
        if (dayNum < 1 || dayNum > 31) {
          return `${month}/${day.slice(0, 1)}`;
        }
      }
      return `${month}/${day}`;
    } else {
      const month = digits.slice(0, 2);
      const day = digits.slice(2, 4);
      const year = digits.slice(4, 8);
      
      if (year.length === 4) {
        const yearNum = parseInt(year);
        const currentYear = new Date().getFullYear();
        if (yearNum < 1900 || yearNum > currentYear) {
          return `${month}/${day}/${year.slice(0, 3)}`;
        }
      }
      
      return `${month}/${day}/${year}`;
    }
  };

  const validateAge = (dateString: string): boolean => {
    if (!dateString || dateString.split('/').length !== 3) return false;
    
    const [mm, dd, yyyy] = dateString.split('/');
    const birthDate = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    const today = new Date();
    
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age >= 13;
  };

  const handleSignUp = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim()) {
      showNotification('error', 'Missing Information', 'Please fill in all fields');
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

    if (dateOfBirth && !validateAge(dateOfBirth)) {
      showNotification('error', 'Age Requirement', 'You must be at least 13 years old to use this app.');
      return;
    }

    setLoading(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      await signUp(email.trim(), password, fullName);
      showNotification('success', 'Account Created!', 'Please check your email to verify your account.');
      setTimeout(() => {
        router.replace('/(auth)/signin');
      }, 2000);
    } catch (error: any) {
      showNotification('error', 'Sign Up Failed', error.message || 'Failed to create account');
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
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>
                Join Sorted to start your emotional wellness journey
              </Text>
            </View>

            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>First Name</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="Enter your first name"
                    placeholderTextColor={Colors.text.tertiary}
                    autoCapitalize="words"
                    autoComplete="given-name"
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Last Name</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Enter your last name"
                    placeholderTextColor={Colors.text.tertiary}
                    autoCapitalize="words"
                    autoComplete="family-name"
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Nickname (Optional)</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={nickname}
                    onChangeText={setNickname}
                    placeholder="Enter a nickname"
                    placeholderTextColor={Colors.text.tertiary}
                    autoCapitalize="words"
                    maxLength={30}
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Phone Number</Text>
                <View style={styles.phoneContainer}>
                  <TouchableOpacity
                    style={styles.countryCodeButton}
                    onPress={() => setShowCountryPicker(!showCountryPicker)}
                  >
                    <Text style={styles.countryCodeText}>
                      {selectedCountry?.dialCode || '+1'}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.phoneInputWrapper}>
                    <TextInput
                      style={styles.phoneInput}
                      value={phoneNumber}
                      onChangeText={setPhoneNumber}
                      placeholder="Phone number"
                      placeholderTextColor={Colors.text.tertiary}
                      keyboardType="phone-pad"
                      maxLength={15}
                    />
                  </View>
                </View>
                {showCountryPicker && (
                  <View style={styles.countryPicker}>
                    <ScrollView style={styles.countryList} nestedScrollEnabled>
                      {COUNTRIES.map((country) => (
                        <TouchableOpacity
                          key={country.code}
                          style={[
                            styles.countryItem,
                            selectedCountry?.code === country.code && styles.selectedCountryItem,
                          ]}
                          onPress={() => {
                            setSelectedCountry(country);
                            setShowCountryPicker(false);
                          }}
                        >
                          <Text style={styles.countryText}>
                            {country.name} ({country.dialCode})
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

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
                    placeholder="Create a password"
                    placeholderTextColor={Colors.text.tertiary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    onBlur={() => setPasswordTouched(true)}
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
              {passwordTouched && !passwordValid && (
                <View style={styles.validationContainer}>
                  {passwordValidation.map((error) => (
                    <Text key={error} style={styles.validationText}>
                      • {error}
                    </Text>
                  ))}
                </View>
              )}
              {!passwordTouched && (
                <Text style={styles.policyHint}>{PASSWORD_RULE_DESCRIPTION}</Text>
              )}

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Confirm Password</Text>
                <View style={[styles.inputWrapper, styles.passwordContainer]}>
                  <TextInput
                    style={styles.passwordInput}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm your password"
                    placeholderTextColor={Colors.text.tertiary}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    onBlur={() => setConfirmTouched(true)}
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
              {confirmTouched && !passwordsMatch && (
                <Text style={styles.validationText}>• Passwords must match.</Text>
              )}

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Date of Birth (Optional)</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={dateOfBirth}
                    onChangeText={(text) => setDateOfBirth(formatDateInput(text))}
                    placeholder="MM/DD/YYYY"
                    keyboardType="numeric"
                    maxLength={10}
                  />
                </View>
              </View>

              <Button
                title="Create Account"
                onPress={handleSignUp}
                loading={loading}
                disabled={!canSubmit}
                variant="primary"
                size="large"
                style={styles.signUpButton}
              />

              <View style={styles.signInContainer}>
                <Text style={styles.signInText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => router.replace('/(auth)/signin')}>
                  <Text style={styles.signInLink}>Sign In</Text>
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
  signUpButton: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  signInContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signInText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
  },
  signInLink: {
    fontSize: Typography.fontSize.base,
    color: Colors.primary[500],
    fontWeight: Typography.fontWeight.semibold,
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
  phoneContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  countryCodeButton: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
    minWidth: 80,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  countryCodeText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
    fontWeight: Typography.fontWeight.medium,
  },
  phoneInputWrapper: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    ...Shadows.small,
  },
  phoneInput: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  countrySelector: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    ...Shadows.small,
  },
  countrySelectorText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  dobContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  calendarButton: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  countryPicker: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    maxHeight: 200,
    ...Shadows.medium,
  },
  countryList: {
    maxHeight: 180,
  },
  countryItem: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  selectedCountryItem: {
    backgroundColor: Colors.primary[50],
  },
  countryText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
});