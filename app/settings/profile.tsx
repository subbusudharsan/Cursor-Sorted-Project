// ProfileSettingsScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Modal,
  ActivityIndicator,
  Animated,
  Platform,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
} from 'react-native';

import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { COUNTRIES, Country } from '@/constants/countries';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  User,
  Edit3,
  X,
  Check,
  Calendar,
  ChevronDown,
  Camera,
  Upload,
  Trash2,
} from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import NotificationBanner from '@/components/ui/NotificationBanner';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  date_of_birth: string | null;
  nickname: string | null;
  country_code: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export default function ProfileSettingsScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // editing flags
  const [editingFirstName, setEditingFirstName] = useState(false);
  const [editingLastName, setEditingLastName] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const [editingDOB, setEditingDOB] = useState(false);
  const [editingCountry, setEditingCountry] = useState(false);

  // temp states
  const [tempFirstName, setTempFirstName] = useState('');
  const [tempLastName, setTempLastName] = useState('');
  const [tempNickname, setTempNickname] = useState('');
  const [tempPhone, setTempPhone] = useState('');
  const [tempDOB, setTempDOB] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [selectedPhoneCountry, setSelectedPhoneCountry] = useState<Country | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // dropdowns
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showPhoneCountryDropdown, setShowPhoneCountryDropdown] = useState(false);

  // date picker
  const [showDatePicker, setShowDatePicker] = useState(false);

  // notifications
  const [phoneError, setPhoneError] = useState('');
  const [isSaveBarVisible, setIsSaveBarVisible] = useState(false);
  const [notification, setNotification] = useState({
    visible: false,
    type: 'info' as 'success' | 'error' | 'info' | 'warning',
    title: '',
    message: '',
  });

  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.95)).current;
  const saveButtonAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 100, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (user) fetchProfile();
  }, [user]);

  // Animate save button when changes are detected
  // Replace the existing useEffect for animation
useEffect(() => {
  console.log('hasUnsavedChanges changed to:', hasUnsavedChanges);
  Animated.timing(saveButtonAnim, {
    toValue: hasUnsavedChanges ? 1 : 0,
    duration: 300,
    useNativeDriver: true,
  }).start(() => {
    console.log('Animation complete for visible:', hasUnsavedChanges);
  });
}, [hasUnsavedChanges]);
  
  // Check for unsaved changes

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user?.id).single();
      if (error) throw error;
      setProfile(data);
      
      // Initialize temp states
      setTempFirstName(data.first_name || '');
      setTempLastName(data.last_name || '');
      setTempNickname(data.nickname || '');
      setTempDOB(formatDOBForInput(data.date_of_birth));
      
      // Handle phone number
      const phoneNumber = data.phone_number || '';
      const phoneCountry = COUNTRIES.find(c => phoneNumber.startsWith(c.dialCode));
      setSelectedPhoneCountry(phoneCountry || COUNTRIES[0]);
      setTempPhone(phoneNumber.replace(/^\+\d+/, '') || '');
      
      // Handle country
      const country = COUNTRIES.find(c => c.code === data.country_code);
      setSelectedCountry(country || null);
      
      // Handle date
      setSelectedDate(data.date_of_birth ? new Date(data.date_of_birth) : null);
    } catch (err) {
      console.error('Error fetching profile:', err);
      showNotification('error', 'Load Failed', 'Could not load your profile information.');
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message?: string
  ) => {
    setNotification({ visible: true, type, title, message: message || '' });
  };

  const saveAllChanges = async () => {
  if (!user || !hasUnsavedChanges) return;
setSaving(true);
try {
  // ✅ Phone validation
  if (tempPhone && selectedPhoneCountry) {
    const digitsOnly = tempPhone.replace(/\D/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
  setPhoneError('Phone number must be 7-15 digits long.');
  showNotification('error', 'Invalid Phone Number', 'Please enter a valid phone number between 7-15 digits.');
  setSaving(false);
  return;
}

  }
  setPhoneError('');

  // ✅ DOB validation
  if (tempDOB) {
    const [mm, dd, yyyy] = tempDOB.split('/');
    const dobDate = new Date(`${yyyy}-${mm}-${dd}`);
    const today = new Date();

    if (
      isNaN(dobDate.getTime()) ||
      dobDate > today || // block future
      yyyy.length !== 4
    ) {
      showNotification(
        'error',
        'Invalid Date of Birth',
        'Please enter a valid past date.'
      );
      setSaving(false);
      return;
    }

    // Check minimum age requirement (13 years)
    if (!validateAge(tempDOB)) {
      showNotification(
        'error',
        'Age Requirement',
        'You must be at least 13 years old to use this app.'
      );
      setSaving(false);
      return;
    }
  }

  const isoDobFromInput = tempDOB.trim() ? parseDOBInputToISO(tempDOB.trim()) : null;
  if (tempDOB.trim() && !isoDobFromInput) {
    showNotification('error', 'Invalid Date of Birth', 'Please use MM/DD/YYYY format.');
    setSaving(false);
    return;
  }

  const updates: any = {
    first_name: tempFirstName.trim() || null,
    last_name: tempLastName.trim() || null,
    nickname: tempNickname.trim() || null,
    phone_number:
      selectedPhoneCountry && tempPhone.trim()
        ? `${selectedPhoneCountry.dialCode}${tempPhone.trim()}`
        : null,
    date_of_birth: isoDobFromInput,
    country_code: selectedCountry?.code || null,
  };

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id);

  if (error) throw error;

setProfile(prev => (prev ? { ...prev, ...updates } : null));

// ✅ sync temp states to saved values so hasUnsavedChanges becomes false
setTempFirstName(updates.first_name || '');
setTempLastName(updates.last_name || '');
setTempNickname(updates.nickname || '');
setTempPhone(
  updates.phone_number
    ? updates.phone_number.replace(/^\+\d+/, '')
    : ''
);
setTempDOB(formatDOBForInput(updates.date_of_birth));
setSelectedCountry(
  COUNTRIES.find(c => c.code === updates.country_code) || null
);
if (updates.date_of_birth) {
  setSelectedDate(new Date(updates.date_of_birth));
} else {
  setSelectedDate(null);
}

// close all edit states
setEditingFirstName(false);
setEditingLastName(false);
setEditingNickname(false);
setEditingPhone(false);
setEditingDOB(false);
setEditingCountry(false);



showNotification('success', 'Profile Updated', 'All changes have been saved successfully.');

// ✅ FORCE buttons to disappear immediately after save
setHasUnsavedChanges(false);
  setIsSaveBarVisible(false); // ✅ force hide buttons after save

  // ✅ Trigger realtime update for nickname change in chats
  if (updates.nickname !== null) {
    // Force a small update to trigger realtime listeners
    await supabase
      .from('profiles')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', user.id);
  }
} catch (err) {
  console.error('Save error:', err);
  showNotification('error', 'Save Failed', 'Unable to save your profile changes. Please try again.');
} finally {
  setSaving(false);
}

};

  const discardChanges = () => {
  if (!profile) return;
  
  // Reset all temp states to original values
  setTempFirstName(profile.first_name || '');
  setTempLastName(profile.last_name || '');
  setTempNickname(profile.nickname || '');
  setTempDOB(formatDOBForInput(profile.date_of_birth));
  
  const phoneNumber = profile.phone_number || '';
  const phoneCountry = COUNTRIES.find(c => phoneNumber.startsWith(c.dialCode));
  setSelectedPhoneCountry(phoneCountry || COUNTRIES[0]);
  setTempPhone(phoneNumber.replace(/^\+\d+/, '') || '');
  
  const country = COUNTRIES.find(c => c.code === profile.country_code);
  setSelectedCountry(country || null);
  
  if (profile.date_of_birth) {
    setSelectedDate(new Date(profile.date_of_birth));
  } else {
    setSelectedDate(null);
  }
  
  // Close all editing modes
  setEditingFirstName(false);
  setEditingLastName(false);
  setEditingNickname(false);
  setEditingPhone(false);
  setEditingDOB(false);

  // ✅ Reset unsaved state
  setHasUnsavedChanges(false);
  setIsSaveBarVisible(false);
};

  const formatDateInput = (text: string) => {
    // Remove all non-digits
    const digits = text.replace(/\D/g, '');
    
    // Format as MM/DD/YYYY with validation
    if (digits.length <= 2) {
      // Validate month (01-12)
      const month = parseInt(digits);
      if (digits.length === 2 && (month < 1 || month > 12)) {
        return digits.slice(0, 1); // Remove invalid second digit
      }
      return digits;
    } else if (digits.length <= 4) {
      const month = digits.slice(0, 2);
      const day = digits.slice(2);
      
      // Validate day (01-31)
      if (day.length === 2) {
        const dayNum = parseInt(day);
        if (dayNum < 1 || dayNum > 31) {
          return `${month}/${day.slice(0, 1)}`; // Remove invalid second digit
        }
      }
      return `${month}/${day}`;
    } else {
      const month = digits.slice(0, 2);
      const day = digits.slice(2, 4);
      const year = digits.slice(4, 8);
      
      // Validate year (1900-current year)
      if (year.length === 4) {
        const yearNum = parseInt(year);
        const currentYear = new Date().getFullYear();
        if (yearNum < 1900 || yearNum > currentYear) {
          return `${month}/${day}/${year.slice(0, 3)}`; // Remove invalid fourth digit
        }
      }
      
      return `${month}/${day}/${year}`;
    }
  };

  const formatDOBForInput = (iso?: string | null) => {
    if (!iso) return '';
    try {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      return `${month}/${day}/${year}`;
    } catch {
      return '';
    }
  };

  const parseDOBInputToISO = (input: string): string | null => {
    if (!input) return null;
    const parts = input.split('/');
    if (parts.length !== 3) return null;
    const [mm, dd, yyyy] = parts;
    if (mm.length !== 2 || dd.length !== 2 || yyyy.length !== 4) return null;
    const month = parseInt(mm, 10);
    const day = parseInt(dd, 10);
    const year = parseInt(yyyy, 10);
    if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(year)) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    const candidate = new Date(year, month - 1, day);
    if (Number.isNaN(candidate.getTime())) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const validateAge = (dateString: string): boolean => {
    if (!dateString || dateString.split('/').length !== 3) return false;
    
    const [mm, dd, yyyy] = dateString.split('/');
    const birthDate = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    const today = new Date();
    
    // Calculate age
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age >= 13;
  };

  const uploadAvatar = async (uri: string) => {
    if (!user) return;
    setUploading(true);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const fileExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, arrayBuffer, {
          contentType: `image/${fileExt}`,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : null);
      showNotification('success', 'Avatar Updated', 'Your profile picture has been updated.');
    } catch (error) {
      console.error('Error uploading avatar:', error);
      showNotification('error', 'Upload Failed', 'Could not update your profile picture.');
    } finally {
      setUploading(false);
      setShowAvatarModal(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await uploadAvatar(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await uploadAvatar(result.assets[0].uri);
    }
  };

  const removeAvatar = async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', user.id);

      if (error) throw error;

      setProfile(prev => prev ? { ...prev, avatar_url: null } : null);
      setShowAvatarModal(false);
      showNotification('success', 'Avatar Removed', 'Your profile picture has been removed.');
    } catch (error) {
      console.error('Error removing avatar:', error);
      showNotification('error', 'Remove Failed', 'Could not remove your profile picture.');
    }
  };

  const formatPhoneDisplay = (phoneNumber: string | null) => {
    if (!phoneNumber) return 'Not set';
    const country = COUNTRIES.find(c => phoneNumber.startsWith(c.dialCode));
    if (country) {
      const number = phoneNumber.replace(country.dialCode, '');
      return `${country.dialCode} ${number}`;
    }
    return phoneNumber;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" />
          <Text style={styles.loadingText}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <NotificationBanner {...notification} onDismiss={() => setNotification(p => ({ ...p, visible: false }))} />
      <SafeAreaView style={styles.container}>
       <TouchableWithoutFeedback
  accessible={false}   // ✅ allow touches to pass through for scrolling
  onPress={() => {
    setShowPhoneCountryDropdown(false);
    setShowCountryDropdown(false);
  }}
>
  <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>

            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <ArrowLeft size={24} color={Colors.text.secondary} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Profile Settings</Text>
              <View style={styles.placeholder} />
            </View>

           
            
            <KeyboardAvoidingView
  style={{ flex: 1 }}
  behavior={Platform.OS === "ios" ? "padding" : undefined}
  keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
>
  <ScrollView
    style={styles.scrollView}
    contentContainerStyle={styles.scrollContent}
    showsVerticalScrollIndicator={false}
    keyboardShouldPersistTaps="handled"
    keyboardDismissMode="on-drag"
    bounces={true}
    decelerationRate="fast"
    scrollEventThrottle={16}
    nestedScrollEnabled={true}
    overScrollMode="always"
  >



              {/* Avatar Section */}
              <View style={styles.profilePictureSection}>
                <Text style={styles.sectionTitle}>Profile Picture</Text>
                <TouchableOpacity
                  style={styles.avatarContainer}
                  onPress={() => setShowAvatarModal(true)}
                  disabled={uploading}
                  activeOpacity={0.8}
                >
                  {uploading ? (
                    <View style={styles.avatarPlaceholderClean}>
                      <ActivityIndicator size="large" color={Colors.primary[500]} />
                    </View>
                  ) : profile?.avatar_url ? (
                    <Image source={{ uri: profile.avatar_url }} style={styles.avatarClean} />
                  ) : (
                    <View style={styles.avatarCircle}>
  <User size={24} color="#FFEB3B" />
</View>

                  )}
                </TouchableOpacity>
              </View>

              {/* First Name */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>First Name</Text>
                {editingFirstName ? (
                  <View style={styles.editRow}>
                    <TextInput
  style={styles.input}
  value={tempFirstName}
  onChangeText={(val) => {
    setTempFirstName(val);
    setHasUnsavedChanges(true);
    setIsSaveBarVisible(true);
  }}
  placeholder="Enter first name"
  autoFocus
  maxLength={50}
/>

                    <TouchableOpacity onPress={() => setEditingFirstName(false)}>
                      <Check size={20} color={Colors.success[500]} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.row} onPress={() => setEditingFirstName(true)}>
                    <Text style={styles.value}>{tempFirstName || 'Not set'}</Text>
                    <Edit3 size={16} color={Colors.text.tertiary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Last Name */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Last Name</Text>
                {editingLastName ? (
                  <View style={styles.editRow}>
                    <TextInput
                      style={styles.input}
                      value={tempLastName}
                    onChangeText={(val) => {
  setTempLastName(val);
  setHasUnsavedChanges(true);
  setIsSaveBarVisible(true);
}}

                      placeholder="Enter last name"
                      autoFocus
                      maxLength={50}
                    />
                    <TouchableOpacity onPress={() => setEditingLastName(false)}>
                      <Check size={20} color={Colors.success[500]} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.row} onPress={() => setEditingLastName(true)}>
                    <Text style={styles.value}>{tempLastName || 'Not set'}</Text>
                    <Edit3 size={16} color={Colors.text.tertiary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Nickname */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Nickname</Text>
                {editingNickname ? (
                  <View style={styles.editRow}>
                    <TextInput
                      style={styles.input}
                      value={tempNickname}
                     onChangeText={(val) => {
  setTempNickname(val);
  setHasUnsavedChanges(true);
  setIsSaveBarVisible(true);
}}

                      placeholder="Enter nickname"
                      autoFocus
                      maxLength={30}
                    />
                    <TouchableOpacity onPress={() => setEditingNickname(false)}>
                      <Check size={20} color={Colors.success[500]} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.row} onPress={() => setEditingNickname(true)}>
                    <Text style={styles.value}>{tempNickname || 'Not set'}</Text>
                    <Edit3 size={16} color={Colors.text.tertiary} />
                  </TouchableOpacity>
                )}
              </View>

           {/* Phone Number */}
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Phone Number</Text>
  {editingPhone ? (
    <View style={styles.phoneEditContainer}>
      {/* Country Code */}
      <View style={styles.phoneCountryContainer}>
        <TouchableOpacity
          style={styles.dropdownButton}
          onPress={() => {
            setShowPhoneCountryDropdown(!showPhoneCountryDropdown);
            setShowCountryDropdown(false);
            setShowDatePicker(false);
          }}
        >
          <Text style={styles.dropdownText}>
            {selectedPhoneCountry?.dialCode || '+1'}
          </Text>
          <ChevronDown size={16} color={Colors.text.tertiary} />
        </TouchableOpacity>
      </View>

      {/* Phone Input */}
     <TextInput
  style={[styles.input, styles.phoneInput]}
  value={tempPhone}
 onChangeText={(val) => {
  setTempPhone(val);
  setHasUnsavedChanges(true);
  setIsSaveBarVisible(true);
}}

  placeholder="Phone number"
  keyboardType="phone-pad"
  maxLength={15}
/>

{/* 🔴 Inline error */}
{phoneError ? (
  <Text style={{ color: Colors.error[500], marginTop: 4 }}>
    {phoneError}
  </Text>
) : null}

{/* ✅ Save */}
<TouchableOpacity
  onPress={() => {
    setEditingPhone(false);
  }}
>
  <Check size={20} color={Colors.success[500]} />
</TouchableOpacity>

    </View>
  ) : (
    <TouchableOpacity
      style={styles.row}
      onPress={() => {
        // ✅ Prefill phone input with saved number
        if (profile?.phone_number && selectedPhoneCountry) {
          setTempPhone(profile.phone_number.replace(selectedPhoneCountry.dialCode, ''));
        }
        setEditingPhone(true);
      }}
    >
      <Text style={styles.value}>
        {tempPhone && selectedPhoneCountry
          ? `${selectedPhoneCountry.dialCode} ${tempPhone}`
          : formatPhoneDisplay(profile?.phone_number)}
      </Text>
      <Edit3 size={16} color={Colors.text.tertiary} />
    </TouchableOpacity>
  )}

  {/* Inline Dropdown */}
  {showPhoneCountryDropdown && (
    <View style={styles.dropdownInline}>
     <ScrollView
  style={{ maxHeight: 200 }}
  nestedScrollEnabled={true}
  showsVerticalScrollIndicator={true}
  keyboardShouldPersistTaps="handled"
  keyboardDismissMode="on-drag"
  overScrollMode="always"
>

        {COUNTRIES.map((country) => (
          <TouchableOpacity
            key={country.code}
            style={[
              styles.dropdownItem,
              selectedPhoneCountry?.code === country.code && styles.selectedDropdownListItem,
            ]}
            onPress={() => {
  setSelectedPhoneCountry(country);
  setShowPhoneCountryDropdown(false);
  setHasUnsavedChanges(true);
  setIsSaveBarVisible(true);
}}

          >
            <Text style={styles.dropdownText}>
              {country.code} - {country.name} ({country.dialCode})
            </Text>
            {selectedPhoneCountry?.code === country.code && (
              <Check size={16} color={Colors.primary[500]} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )}
</View>


{/* Country */}
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Country</Text>
  {editingCountry ? (
    <View>
      <TouchableOpacity
        style={styles.dropdownButton}
        onPress={() => {
          setShowCountryDropdown(!showCountryDropdown);
          setShowPhoneCountryDropdown(false);
          setShowDatePicker(false);
        }}
      >
        <Text style={styles.dropdownText}>
          {selectedCountry
            ? `${selectedCountry.name} (${selectedCountry.code})`
            : 'Select country'}
        </Text>
        <ChevronDown size={16} color={Colors.text.tertiary} />
      </TouchableOpacity>

      {showCountryDropdown && (
        <View style={styles.dropdownInline}>
         <ScrollView
  style={{ maxHeight: 200 }}
  nestedScrollEnabled={true}
  showsVerticalScrollIndicator={true}
  keyboardShouldPersistTaps="handled"
  keyboardDismissMode="on-drag"
  overScrollMode="always"
>

            {COUNTRIES.map((country) => (
              <TouchableOpacity
                key={country.code}
                style={[
                  styles.dropdownItem,
                  selectedCountry?.code === country.code &&
                    styles.selectedDropdownListItem,
                ]}
               onPress={() => {
  setSelectedCountry(country);
  setShowCountryDropdown(false);
  setHasUnsavedChanges(true);
  setIsSaveBarVisible(true);
}}

              >
                <Text style={styles.dropdownText}>
                  {country.code} - {country.name} ({country.dialCode})
                </Text>
                {selectedCountry?.code === country.code && (
                  <Check size={16} color={Colors.primary[500]} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      
      <View style={styles.editActions}>
        <TouchableOpacity onPress={() => {
          setEditingCountry(false);
          setShowCountryDropdown(false);
        }}>
          <Check size={20} color={Colors.success[500]} />
        </TouchableOpacity>
      </View>
    </View>
  ) : (
    <TouchableOpacity
      style={styles.row}
      onPress={() => {
        setEditingCountry(true);
        setShowCountryDropdown(false);
        setShowPhoneCountryDropdown(false);
      }}
    >
      <Text style={styles.value}>{selectedCountry?.name || 'Not set'}</Text>
      <Edit3 size={16} color={Colors.text.tertiary} />
    </TouchableOpacity>
  )}
</View>

             {/* Date of Birth */}
{/* Date of Birth */}
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Date of Birth</Text>

  {!editingDOB ? (
    <TouchableOpacity
      style={styles.row}
      onPress={() => {
        setEditingDOB(true);
        setShowDatePicker(true);
        setShowCountryDropdown(false);
        setShowPhoneCountryDropdown(false);
      }}
    >
      <Text style={styles.value}>{tempDOB || 'Not set'}</Text>
      <Edit3 size={16} color={Colors.text.tertiary} />
    </TouchableOpacity>
  ) : (
    <View>
      <View style={styles.editRow}>
        {/* Manual typing */}
        <TextInput
          style={styles.input}
          value={tempDOB}
         onChangeText={(text) => {
  const formatted = formatDateInput(text);
  setTempDOB(formatted);
  if (formatted.length === 10) {
    const [mm, dd, yyyy] = formatted.split('/');
    const typedDate = new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
    if (!Number.isNaN(typedDate.getTime())) {
      setSelectedDate(typedDate);
    }
  } else {
    setSelectedDate(null);
  }
  setHasUnsavedChanges(true);
  setIsSaveBarVisible(true);
}}
          placeholder="MM/DD/YYYY"
          keyboardType="numeric"
          maxLength={10}
        />

        {/* Calendar icon */}
        <TouchableOpacity
          onPress={() => setShowDatePicker(!showDatePicker)}
          style={{ marginLeft: 8 }}
        >
          <Calendar size={20} color={Colors.primary[500]} />
        </TouchableOpacity>

        {/* ✅ Save button */}
        <TouchableOpacity
        
          onPress={() => {
            setEditingDOB(false);
            setShowDatePicker(false);
          }}
          style={{ marginLeft: 8 }}
        >
          <Check size={20} color={Colors.success[500]} />
        </TouchableOpacity>
      </View>

      {/* Inline Date Picker */}
      {showDatePicker && (
        <View style={styles.datePickerContainer}>
          <DateTimePicker
            value={
              tempDOB && tempDOB.split('/').length === 3 && tempDOB.split('/')[2].length === 4
                ? (() => {
                    const [mm, dd, yyyy] = tempDOB.split('/');
                    return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
                  })()
                : new Date()
            }
            mode="date"
            display="default"
            maximumDate={new Date()}
            minimumDate={new Date(1900, 0, 1)}
           onChange={(event, date) => {
  if (date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    const formatted = `${month}/${day}/${year}`;
    setTempDOB(formatted);
    setSelectedDate(date);
    setHasUnsavedChanges(true);
    setIsSaveBarVisible(true);
    setShowDatePicker(false);
  }
}}

          />
        </View>
      )}
    </View>
  )}
</View>

              {/* Account Information */}
              <View style={{ marginTop: Spacing.lg }}>
                <Text style={styles.sectionTitle}>Account Information</Text>
              </View>
              <View style={styles.infoCard}>
  <View style={styles.infoRowColumn}>
    <Text style={styles.infoLabel}>Email: </Text>
    <Text style={styles.infoValue} selectable>
      {profile?.email}
    </Text>
  </View>

  <View style={styles.infoRowColumn}>
    <Text style={styles.infoLabel}>Member Since: </Text>
    <Text style={styles.infoValue}>
      {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : 'Unknown'}
    </Text>
  </View>
</View>
            
            {/* Spacer for save button */}
<View style={{ height: 60 }} />
</ScrollView>
</KeyboardAvoidingView>


          {/* Floating Save Button */}
{isSaveBarVisible ? (
  <Animated.View 
    style={[
      styles.saveButtonContainer,
      {
        opacity: saveButtonAnim,
        transform: [
          {
            translateY: saveButtonAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [100, 0],
            }),
          },
        ],
      },
    ]}
  >
    <View style={styles.saveButtonRow}>
      <TouchableOpacity
        style={styles.discardButton}
        onPress={discardChanges}
        disabled={saving}
      >
        <X size={18} color={Colors.text.secondary} />
        <Text style={styles.discardButtonText}>Discard</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={saveAllChanges}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Check size={18} color="#FFFFFF" />
        )}
        <Text style={styles.saveButtonText}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Text>
      </TouchableOpacity>
    </View>
  </Animated.View>
) : null}
          </Animated.View>
        </TouchableWithoutFeedback>

        {/* Avatar Modal - Keep this as modal since it's for camera/photo selection */}
        <Modal visible={showAvatarModal} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowAvatarModal(false)}>
                <X size={24} color={Colors.text.secondary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Profile Picture</Text>
              <View style={styles.placeholder} />
            </View>
            <View style={styles.modalContent}>
              <TouchableOpacity style={styles.avatarOption} onPress={takePhoto}>
                <View style={styles.avatarOptionIcon}>
                  <Camera size={24} color={Colors.primary[500]} />
                </View>
                <Text style={styles.avatarOptionText}>Take Photo</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.avatarOption} onPress={pickImage}>
                <View style={styles.avatarOptionIcon}>
                  <Upload size={24} color={Colors.primary[500]} />
                </View>
                <Text style={styles.avatarOptionText}>Choose from Library</Text>
              </TouchableOpacity>
              
              {profile?.avatar_url && (
                <TouchableOpacity style={[styles.avatarOption, styles.removeOption]} onPress={removeAvatar}>
                  <View style={[styles.avatarOptionIcon, styles.removeOptionIcon]}>
                    <Trash2 size={24} color={Colors.error[500]} />
                  </View>
                  <Text style={[styles.avatarOptionText, styles.removeOptionText]}>Remove Photo</Text>
                </TouchableOpacity>
              )}
            </View>
          </SafeAreaView>
        </Modal>

      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background 
  },
  content: { 
    flex: 1 
  },
  loadingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    gap: Spacing.lg 
  },
  loadingText: { 
    fontSize: Typography.fontSize.lg, 
    color: Colors.text.secondary, 
    fontWeight: Typography.fontWeight.medium 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surfaceElevated,
    ...Shadows.small,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  headerTitle: { 
    fontSize: Typography.fontSize.xl, 
    fontWeight: Typography.fontWeight.bold, 
    color: Colors.text.primary 
  },
  placeholder: { 
    width: 40 
  },
  scrollView: { 
    flex: 1 
  },
  scrollContent: { 
    paddingHorizontal: Spacing.sm,
    paddingTop: 4,
    paddingBottom: 60,
  },
  profilePictureSection: {
    marginBottom: Spacing.xs,
    backgroundColor: 'transparent',
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
  },
  section: { 
  marginBottom: Spacing.sm,
  backgroundColor: '#ffffff',
  borderRadius: BorderRadius.lg,
  padding: Spacing.sm,
  borderWidth: 1.5,
  borderColor: '#FFEB3B',
  ...Shadows.small,
},

  sectionTitle: { 
  fontSize: Typography.fontSize.sm, 
  fontWeight: Typography.fontWeight.semibold, 
  marginBottom: Spacing.xs, 
  color: '#0288D1', // dark sky blue / navy accent
},

  row: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    minHeight: 32,
  },
  editRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    minHeight: 32,
  },
  input: { 
    flex: 1, 
    borderWidth: 1.5, 
    borderColor: '#FFEB3B',
    borderRadius: BorderRadius.lg, 
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    fontSize: Typography.fontSize.sm,
    backgroundColor: '#ffffff',
    color: Colors.text.primary,
    minHeight: 32,
    ...Shadows.small,
  },
  phoneInput: {
    flex: 2,
  },
  value: { 
    fontSize: Typography.fontSize.sm, 
    color: Colors.text.secondary, 
  },
  subValue: { 
    fontSize: Typography.fontSize.sm, 
    color: Colors.text.tertiary 
  },
  avatarContainer: {
  marginBottom: Spacing.sm,
  alignSelf: 'center',
},
avatarClean: { 
  width: 48, 
  height: 48, 
  borderRadius: BorderRadius.xxl,
},

avatarPlaceholderClean: {
  width: 48,
  height: 48,
  borderRadius: BorderRadius.xxl,
  backgroundColor: '#E0F7FA',
  justifyContent: 'center',
  alignItems: 'center',
  borderWidth: 2,
  borderColor: '#FFEB3B',
},


  datePickerInline: {
    marginTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  datePickerContainer: {
    marginTop: 4,
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
    borderWidth: 1.5,
    borderColor: '#FFEB3B',
    maxHeight: 300,
    overflow: 'hidden',
    ...Shadows.small,
  },
  phoneEditContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    minHeight: 32,
  },
  phoneCountryContainer: {
    position: 'relative',
    flex: 1,
  },
  countryContainer: {
    position: 'relative',
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: '#FFEB3B',
    borderRadius: BorderRadius.lg,
    backgroundColor: '#E0F7FA',
    minHeight: 36,
    ...Shadows.small,
  },
  dropdownText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#FFEB3B',
    backgroundColor: '#E0F7FA',
    minHeight: 32,
  },
  dropdownListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  selectedDropdownListItem: {
    backgroundColor: '#E0F7FA',
    borderBottomColor: '#FFEB3B',
  },
  datePickerContent: {
    padding: Spacing.lg,
  },
  inlineDatePicker: {
    width: '100%',
    backgroundColor: Colors.surface,
  },
  countryDialCode: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[600],
    minWidth: 60,
    marginRight: Spacing.md,
  },
  countryName: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
    flex: 1,
  },
  infoCard: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.lg,
    padding: Spacing.xs,
    borderWidth: 2,
   borderColor: '#0277BD',
    ...Shadows.small,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  infoLabel: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.semibold,
    marginBottom: 2,
    letterSpacing: 0.5,
  },
infoValue: {
  fontSize: Typography.fontSize.sm,
  color: Colors.text.primary,
  fontWeight: Typography.fontWeight.regular,
  lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  width: '100%',
},


  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surfaceElevated,
  },
  modalTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  modalContent: {
    flex: 1,
    padding: Spacing.xl,
  },
  avatarOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  removeOption: {
    borderColor: Colors.error[200],
    backgroundColor: Colors.error[50],
  },
  avatarOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.lg,
   backgroundColor: '#FFEB3B',
   borderWidth: 2,
   borderColor: '#0277BD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.lg,
  },
  removeOptionIcon: {
    backgroundColor: Colors.error[100],
  },
  avatarOptionText: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.primary,
  },
  removeOptionText: {
    color: Colors.error[600],
  },
  saveButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#F0F8FF',
    borderTopWidth: 1,
    borderTopColor: '#0277BD',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 6,
    ...Shadows.large,
    zIndex: 8000,
    elevation: 15,
  },
  saveButtonRow: {
    flexDirection: 'row',
    gap: 4,
  },
  discardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFEF0',
    borderWidth: 1,
    borderColor: '#FFD700',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.lg,
    flex: 1,
    gap: 4,
    ...Shadows.small,
  },
  discardButtonText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFEB3B',
    borderWidth: 1.5,
    borderColor: '#0277BD',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.lg,
    flex: 2,
    gap: 4,
    ...Shadows.medium,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: '#0277BD',
    textShadowColor: '#FFD700',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },

dropdownInline: {
  position: 'relative',
  borderWidth: 1.5,
  borderColor: '#FFEB3B',
  borderRadius: BorderRadius.lg,
  backgroundColor: '#ffffff',
  marginTop: 4,
  maxHeight: 200,
  zIndex: 9999,
  elevation: 10,
  ...Shadows.small,
},

editActions: {
  flexDirection: 'row',
  justifyContent: 'flex-end',
  marginTop: 4,
},

datePickerOverlay: {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 10000,
  elevation: 30,
},
datePickerCard: {
  backgroundColor: Colors.surfaceElevated,
  borderRadius: BorderRadius.xl,
  padding: Spacing.xl,
  marginHorizontal: Spacing.xl,
  maxWidth: 400,
  width: '90%',
  ...Shadows.large,
},
datePickerHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: Spacing.lg,
},
datePickerTitle: {
  fontSize: Typography.fontSize.lg,
  fontWeight: Typography.fontWeight.semibold,
  color: Colors.text.primary,
},
webDatePickerContainer: {
  width: '100%',
},
nativeDatePickerContainer: {
  width: '100%',
  alignItems: 'center',
},
  infoRowColumn: {
  flexDirection: 'column',
  alignItems: 'flex-start',
  marginBottom: 4,
  width: '100%',
},
  // In StyleSheet
avatarCircle: {
  width: 48,          // smaller circle
  height: 48,
  borderRadius: 24,   // keep circle
  borderWidth: 2,
  borderColor: '#0D47A1',     // dark navy blue border
  backgroundColor: '#42A5F5', // sky blue fill
  justifyContent: 'center',
  alignItems: 'center',
  alignSelf: 'center',
  marginTop: 4,       // tighter spacing
  marginBottom: 8,
},

});