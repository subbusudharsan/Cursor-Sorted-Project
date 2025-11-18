import React, { useMemo, useState } from 'react';
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { COUNTRIES } from '@/constants/countries';
import { ArrowLeft, Eye, EyeOff, Calendar, UserPlus, User, Mail, Lock, Phone, Calendar as CalendarIcon } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { isStrongPassword, PASSWORD_RULE_DESCRIPTION, getPasswordErrors } from '@/utils/passwordPolicy';
import Button from '@/components/ui/Button';
import NotificationBanner from '@/components/ui/NotificationBanner';
import KeyboardSafeView from '@/components/KeyboardSafeView';

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

  // Individual password rule checks (for live indicators)
  const passwordRules = useMemo(() => {
    const pwd = password;
    return {
      length: pwd.length >= 8,
      uppercase: /[A-Z]/.test(pwd),
      number: /\d/.test(pwd),
      special: /[@$!%*?&]/.test(pwd),
    };
  }, [password]);

  // Check if all password rules pass
  const allPasswordRulesPass = useMemo(() => {
    return passwordRules.length && passwordRules.uppercase && passwordRules.number && passwordRules.special;
  }, [passwordRules]);
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
      showNotification('error', 'Missing Information', 'Please fill in all required fields.');
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
      const result = await signUp(email.trim(), password, fullName);
      
      // Check if user was created successfully
      if (result?.user) {
        // Navigate to sign-in page
        showNotification('success', 'Account Created!', 'Please check your email to verify your account, then sign in.');
        setTimeout(() => {
          router.replace('/(auth)/signin');
        }, 1500);
      } else {
        throw new Error('Failed to create account. Please try again.');
      }
    } catch (error: any) {
      // Show only real Supabase error messages
      const errorMessage = error?.message || 'Failed to create account. Please try again.';
      showNotification('error', 'Sign Up Failed', errorMessage);
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
                  <UserPlus size={24} color={Colors.primary[700]} />
                </View>
              </View>
              
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>
                Join Sorted to start your emotional wellness journey
              </Text>
            </View>

            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <View style={styles.labelContainer}>
                  <User size={16} color={Colors.primary[500]} style={styles.labelIcon} />
                  <Text style={styles.label}>First Name</Text>
                </View>
                <View style={[styles.inputWrapper, styles.nameInputWrapper]}>
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
                <View style={styles.labelContainer}>
                  <User size={16} color={Colors.primary[500]} style={styles.labelIcon} />
                  <Text style={styles.label}>Last Name</Text>
                </View>
                <View style={[styles.inputWrapper, styles.nameInputWrapper]}>
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
                <View style={styles.labelContainer}>
                  <User size={16} color={Colors.text.secondary} style={styles.labelIcon} />
                  <Text style={styles.label}>Nickname (Optional)</Text>
                </View>
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
                <View style={styles.labelContainer}>
                  <Phone size={16} color={Colors.secondary[500]} style={styles.labelIcon} />
                  <Text style={styles.label}>Phone Number</Text>
                </View>
                <View style={styles.phoneContainer}>
                  <TouchableOpacity
                    style={[styles.countryCodeButton, styles.phoneInputAccent]}
                    onPress={() => setShowCountryPicker(!showCountryPicker)}
                  >
                    <Text style={styles.countryCodeText}>
                      {selectedCountry?.dialCode || '+1'}
                    </Text>
                  </TouchableOpacity>
                  <View style={[styles.phoneInputWrapper, styles.phoneInputAccent]}>
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
                <View style={[styles.countryPicker, !showCountryPicker && styles.countryPickerHidden]}>
                  <ScrollView 
                    style={styles.countryList} 
                    nestedScrollEnabled
                    bounces={false}
                    removeClippedSubviews={false}
                  >
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
              </View>

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
              
              {/* PASSWORD RULE INDICATORS - Hide when all rules pass */}
              <View style={[styles.validationContainer, (password.length === 0 || allPasswordRulesPass) && styles.validationContainerHidden]}>
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

              <View style={styles.inputContainer}>
                <View style={styles.labelContainer}>
                  <Lock size={16} color={Colors.secondary[500]} style={styles.labelIcon} />
                  <Text style={styles.label}>Confirm Password</Text>
                </View>
                <View style={[styles.inputWrapper, styles.passwordContainer, styles.passwordInputWrapper]}>
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

              <View style={styles.inputContainer}>
                <View style={styles.labelContainer}>
                  <CalendarIcon size={16} color={Colors.text.secondary} style={styles.labelIcon} />
                  <Text style={styles.label}>Date of Birth (Optional)</Text>
                </View>
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
                <TouchableOpacity 
                  style={styles.signInButton}
                  onPress={() => router.replace('/(auth)/signin')}
                >
                  <Text style={styles.signInLink}>Sign In</Text>
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
    paddingTop: 10,
    paddingBottom: Spacing.xl,
  },
  content: {
    flex: 1,
  },
  header: {
    marginBottom: Spacing.md,
    alignItems: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    alignSelf: 'flex-start',
    ...Shadows.small,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 0,
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
  title: {
    fontSize: Typography.fontSize['2xl'],
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginTop: 0,
    marginBottom: 0,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    marginTop: 0,
    marginBottom: 0,
  },
  form: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 2,
    borderColor: Colors.primary[100],
    ...Shadows.medium,
  },
  inputContainer: {
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
  nameInputWrapper: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary[300],
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
  phoneInputAccent: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.secondary[400],
  },
  input: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
  },
  eyeButton: {
    padding: Spacing.md,
  },
  signUpButton: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[400],
    shadowColor: Colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  signInContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: Spacing.sm,
  },
  signInText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
  },
  signInButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.secondary[100],
    borderWidth: 1.5,
    borderColor: Colors.secondary[300],
    marginLeft: Spacing.xs,
  },
  signInLink: {
    fontSize: Typography.fontSize.sm,
    color: Colors.secondary[700],
    fontWeight: Typography.fontWeight.semibold,
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
    fontSize: Typography.fontSize.xs,
    color: Colors.error[600],
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.xs,
  },
  policyHint: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
  },
  phoneContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  countryCodeButton: {
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
    minWidth: 70,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  countryCodeText: {
    fontSize: Typography.fontSize.sm,
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
    paddingVertical: Spacing.md,
    fontSize: Typography.fontSize.sm,
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
  countryPickerHidden: {
    height: 0,
    marginTop: 0,
    overflow: 'hidden',
    opacity: 0,
    pointerEvents: 'none',
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