import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Users,
  Search,
  Plus,
  UserPlus,
  UserCheck,
  X,
  Check,
  MessageCircle,
  Mail,
  Bot,
} from 'lucide-react-native';

interface Contact {
  id: string;
  user_id: string;
  contact_id: string;
  status: 'invited' | 'accepted' | 'blocked';
  created_at: string;
  contact_profile?: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
  user_profile?: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  status?: 'not_contact' | 'pending_invite' | 'already_contact' | 'not_registered';
}

function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { readyToTalk, mode } = useLocalSearchParams<{ readyToTalk?: string; mode?: string }>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pendingInvites, setPendingInvites] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [addingContact, setAddingContact] = useState(false);
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingEmailInvite, setSendingEmailInvite] = useState(false);

  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);


  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mainSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    if (user) {
      fetchContacts();
      fetchPendingInvites();
    }
  }, [user]);

  useEffect(() => {
    if (readyToTalk === 'true') {
      Alert.alert(
        "You're Ready to Talk!",
        "The AI assistant thinks you're ready to have a conversation. Please select a contact to start a new chat.",
        [{ text: 'OK' }]
      );
      router.setParams({ readyToTalk: undefined });
    }
  }, [readyToTalk]);

  // Debounced search for modal
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (inviteEmail.trim() && inviteEmail.includes('@')) {
      searchTimeoutRef.current = setTimeout(() => {
        searchUsers(inviteEmail.trim());
      }, 500);
    } else {
      setSearchResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [inviteEmail]);

  // Debounced search for main search bar
  useEffect(() => {
    if (mainSearchTimeoutRef.current) {
      clearTimeout(mainSearchTimeoutRef.current);
    }

    if (searchQuery.trim() && searchQuery.includes('@')) {
      mainSearchTimeoutRef.current = setTimeout(() => {
        searchUsers(searchQuery.trim());
      }, 500);
    } else {
      setSearchResults([]);
    }

    return () => {
      if (mainSearchTimeoutRef.current) {
        clearTimeout(mainSearchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select(
          `
          *,
          contact_profile:profiles!contacts_contact_id_fkey(
            id,
            email,
            full_name,
            avatar_url
          )
          `
        )
        .eq('user_id', user?.id)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContacts(data || []);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      Alert.alert('Error', 'Failed to load contacts');
    }
  };

  const fetchPendingInvites = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select(
          `
          *,
          user_profile:profiles!contacts_user_id_fkey(
            id,
            email,
            full_name,
            avatar_url
          )
          `
        )
        .eq('contact_id', user?.id)
        .eq('status', 'invited')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPendingInvites(data || []);
    } catch (error) {
      console.error('Error fetching pending invites:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async (email: string) => {
    if (!email.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      
      if (trimmedEmail === user?.email?.toLowerCase()) {
        Alert.alert('Error', "You can't search for your own email address.");
        setSearchResults([]);
        setSearching(false);
        return;
      }

      const { data: usersFound, error: userSearchError } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .ilike('email', `%${trimmedEmail}%`);

      if (userSearchError) throw userSearchError;

      const foundUser = usersFound?.[0];

      if (!foundUser) {
        // User is not registered in the database
        setSearchResults([
          {
            id: 'unregistered',
            email: email.trim(),
            full_name: null,
            avatar_url: null,
            status: 'not_registered',
          },
        ]);
        return;
      }

      const { data: contactStatus, error: contactStatusError } = await supabase
        .from('contacts')
        .select('status')
        .eq('user_id', user?.id)
        .eq('contact_id', foundUser.id)
        .single();

      if (contactStatusError && contactStatusError.code !== 'PGRST116') {
        throw contactStatusError;
      }
      
      const updatedUser: UserProfile = { ...foundUser };

      if (contactStatus?.status === 'accepted') {
        updatedUser.status = 'already_contact';
      } else if (contactStatus?.status === 'invited') {
        updatedUser.status = 'pending_invite';
      } else {
        // Here's the key: if the user is registered but not a contact,
        // we'll explicitly mark them as 'not_contact'
        updatedUser.status = 'not_contact';
      }
      
      setSearchResults([updatedUser]);

    } catch (error) {
      console.error('Error during user search:', error);
      Alert.alert('Error', 'Failed to search users. Please try again.');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const sendEmailInvite = async (email: string) => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setSendingEmailInvite(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-email-invite', {
        body: {
          email: email.trim(),
          inviter_name: user?.user_metadata?.full_name || user?.email || 'Someone',
          inviter_email: user?.email,
        },
      });

      if (error) throw error;

      Alert.alert(
        'Invite Sent!',
        `An invitation email has been sent to ${email.trim()}. They'll receive instructions to join Sorted and connect with you.`,
        [{ text: 'OK', onPress: () => {
          setInviteEmail('');
          setSearchResults([]);
          setShowInviteModal(false);
          setSearchQuery('');
        }}]
      );
    } catch (error) {
      console.error('Error sending email invite:', error);
      Alert.alert('Error', 'Failed to send email invitation. Please try again.');
    } finally {
      setSendingEmailInvite(false);
    }
  };
  
const addRegisteredUser = async (contactProfile: UserProfile) => {
    if (!user) return;
    setAddingContact(true);
    try {
      // Check for an existing relationship first to avoid duplicates
      const { data: existingRelationship, error: relationshipError } = await supabase
        .from('contacts')
        .select('id')
        .eq('user_id', user.id)
        .eq('contact_id', contactProfile.id)
        .single();

      if (relationshipError && relationshipError.code !== 'PGRST116') {
        throw relationshipError;
      }

      if (existingRelationship) {
        Alert.alert('Info', `${contactProfile.full_name || contactProfile.email} is already your contact.`);
        return;
      }

      // Insert only one row (A → B). Reciprocal will be auto-created by trigger
const { error: userToContactError } = await supabase
  .from('contacts')
  .insert({
    user_id: user.id,
    contact_id: contactProfile.id,
    status: 'accepted',
  });

if (userToContactError) throw userToContactError;

      Alert.alert('Success', `${contactProfile.full_name || contactProfile.email} added to contacts!`);
      
      // Close the modal and refresh the contacts list
      setInviteEmail('');
      setSearchResults([]);
      setShowInviteModal(false);
      setSearchQuery('');
      await fetchContacts();

    } catch (error) {
      console.error('Error adding registered user:', error);
      Alert.alert('Error', 'Failed to add user to contacts. Please try again.');
    } finally {
      setAddingContact(false);
    }
  };

  const acceptInvite = async (invite: Contact) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ status: 'accepted' })
        .eq('id', invite.id);

      if (error) throw error;

      const { error: reciprocalError } = await supabase.from('contacts').insert({
        user_id: user?.id,
        contact_id: invite.user_id,
        status: 'accepted',
      });

      if (reciprocalError) throw reciprocalError;

      Alert.alert('Success', 'Contact added successfully!');
      await fetchContacts();
      await fetchPendingInvites();
    } catch (error) {
      console.error('Error accepting invite:', error);
      Alert.alert('Error', 'Failed to accept invite');
    }
  };

  const rejectInvite = async (invite: Contact) => {
    try {
      const { error } = await supabase.from('contacts').delete().eq('id', invite.id);

      if (error) throw error;

      Alert.alert('Success', 'Invite rejected');
      await fetchPendingInvites();
    } catch (error) {
      console.error('Error rejecting invite:', error);
      Alert.alert('Error', 'Failed to reject invite');
    }
  };

  const startChat = async (contact: Contact | UserProfile) => {
    try {
      const targetContactId = ('contact_profile' in contact && contact.contact_profile)
        ? contact.contact_profile.id
        : contact.id;

      if (!targetContactId) {
        throw new Error('Contact ID is missing for chat initiation.');
      }

      // If we're in AI chat mode, check conversation limit first
      if (mode === 'ai_chat') {
        console.log('✅ AI chat mode detected, checking conversation limit for contactId:', targetContactId);

        // Check how many active My Talks (contact_chat) exist with this contact
        const { count, error: countError } = await supabase
          .from('chats')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user?.id)
          .eq('contact_id', targetContactId)
          .eq('chat_type', 'contact_chat')
          .eq('is_resolved', false);
        
        console.log(`📊 AI Chat Limit Check: My Talks count with ${targetContactId}: ${count}`);

        if (countError) {
          console.error('❌ Error checking conversation count:', countError);
          throw countError;
        }

        // Get contact name for alert
        const contactName = ('contact_profile' in contact && contact.contact_profile)
          ? (contact.contact_profile.full_name || contact.contact_profile.email)
          : (('full_name' in contact ? contact.full_name : null) || ('email' in contact ? contact.email : 'this person'));

          if ((count ?? 0) >= 3) {
            Alert.alert(
              'Limit reached',
              `You’ve got 3 chats going with ${contactName}.\n\nJust making sure you're not carrying too much — take a pause ❤️`,
              [{ text: 'OK', style: 'default' }]
            );
            return;
          }
          

        console.log('✅ Conversation limit check passed, navigating to AI chat');
        router.push(`/ai-chat?contactId=${targetContactId}&mode=new`);
        return;
      }

      // Check if we're in "ready to talk" mode and pass that context
      const params = new URLSearchParams({ contactId: targetContactId });
      if (readyToTalk === 'true') {
        params.append('readyToTalk', 'true');
      }

      router.push(`/contact-selection?${params.toString()}`);
    } catch (error) {
      console.error('Error starting chat:', error);
      Alert.alert('Error', 'Failed to start chat');
    }
  };

  const renderSearchResultButton = (profile: UserProfile) => {
    if (profile.status === 'already_contact') {
      // User is already a contact, show Chat icon
      return (
        <TouchableOpacity
          style={styles.chatButton}
          onPress={() => startChat(profile)}
        >
          <MessageCircle size={16} color="#ffffff" />
        </TouchableOpacity>
      );
    } else if (profile.status === 'not_contact') {
      // User is registered but not a contact, show Add icon
      return (
        <TouchableOpacity
          style={[styles.addContactButton, addingContact && styles.addContactButtonDisabled]}
          onPress={() => addRegisteredUser(profile)}
          disabled={addingContact}
        >
          <Plus size={16} color="#ffffff" />
        </TouchableOpacity>
      );
    } else if (profile.status === 'pending_invite') {
      return (
        <View style={styles.pendingButton}>
          <Text style={styles.pendingText}>Pending</Text>
        </View>
      );
    } else if (profile.status === 'not_registered') {
      // User is not registered, show Email Invite icon
      return (
        <TouchableOpacity
          style={[styles.emailInviteButton, sendingEmailInvite && styles.inviteButtonDisabled]}
          onPress={() => sendEmailInvite(profile.email)}
          disabled={sendingEmailInvite}
        >
          <Mail size={16} color="#ffffff" />
        </TouchableOpacity>
      );
    }
  };

const handleLongPress = (contactId: string) => {
  console.log('🔍 CONTACTS - LONG PRESS: Detected on contactId:', contactId);
  console.log('🔍 CONTACTS - LONG PRESS: Current multiSelectMode:', multiSelectMode);
  console.log('🔍 CONTACTS - LONG PRESS: Current selectedContacts:', selectedContacts);
  
  if (!multiSelectMode) {
    console.log('🔍 CONTACTS - LONG PRESS: ENTERING MULTI-SELECT MODE');
    setMultiSelectMode(true);
    setSelectedContacts([contactId]);
    console.log('🔍 CONTACTS - LONG PRESS: Multi-select mode entered with contact:', contactId);
  } else {
    console.log('🔍 CONTACTS - LONG PRESS: TOGGLING CONTACT SELECTION');
    setSelectedContacts(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
    console.log('🔍 CONTACTS - LONG PRESS: Updated selectedContacts after toggle');
  }
};

const handleContactSelect = (contactId: string) => {
  console.log('🔍 CONTACTS - CONTACT SELECT: Tapping contact in multi-select mode:', contactId);
  if (multiSelectMode) {
    console.log('🔍 CONTACTS - CONTACT SELECT: Toggling selection for:', contactId);
    setSelectedContacts(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
    console.log('🔍 CONTACTS - CONTACT SELECT: Updated selectedContacts:', selectedContacts);
  }
};

const cancelMultiSelect = () => {
  setMultiSelectMode(false);
  setSelectedContacts([]);
};
const confirmBulkDelete = () => {
  console.log('🔍 CONTACTS - CONFIRM BULK DELETE: Function triggered');
  console.log('🔍 CONTACTS - CONFIRM BULK DELETE: selectedContacts:', selectedContacts);
  console.log('🔍 CONTACTS - CONFIRM BULK DELETE: selectedContacts length:', selectedContacts.length);
  console.log('🔍 CONTACTS - CONFIRM BULK DELETE: bulkDeleting state:', bulkDeleting);
  
  if (selectedContacts.length === 0) {
    console.log('🔍 CONTACTS - CONFIRM BULK DELETE: No contacts selected, showing alert');
    Alert.alert('No Selection', 'Please select contacts to remove first.');
    return;
  }

  console.log('🔍 CONTACTS - CONFIRM BULK DELETE: Showing confirmation dialog');
  Alert.alert(
    'Remove Contacts',
    `Are you sure you want to remove ${selectedContacts.length} contact${selectedContacts.length > 1 ? 's' : ''}?`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: performBulkDelete },
    ]
  );
};

const performBulkDelete = async () => {
  setBulkDeleting(true);
  try {
    console.log('🗑️ BULK DELETE: Starting deletion process');
    console.log('🗑️ BULK DELETE: Selected contact IDs:', selectedContacts);
    console.log('🗑️ BULK DELETE: Current user ID:', user?.id);

    // Get the actual contact relationship IDs from the selected contact IDs
    const contactsToDelete = contacts.filter(contact => 
      selectedContacts.includes(contact.id)
    );
    
    console.log('🗑️ BULK DELETE: Contacts to delete:', contactsToDelete.map(c => ({
      relationshipId: c.id,
      contactId: c.contact_id,
      contactName: c.contact_profile?.full_name || c.contact_profile?.email
    })));

    if (contactsToDelete.length === 0) {
      throw new Error('No valid contacts found for deletion');
    }

    // Delete the contact relationships (this will remove the bidirectional relationship)
    const relationshipIds = contactsToDelete.map(c => c.id);
    
    const { error, count } = await supabase
      .from('contacts')
      .delete({ count: 'exact' })
      .eq('user_id', user?.id)
      .in('id', relationshipIds);

    console.log('🗑️ BULK DELETE: Delete result:', { error: error?.message, count });
    if (error) throw error;

    if (count === 0) {
      throw new Error('No contacts were deleted. They may have been removed already.');
    }

    console.log('✅ BULK DELETE: Successfully deleted', count, 'contact relationships');
    Alert.alert('Success', 'Selected contacts removed successfully');
    await fetchContacts();
  } catch (err) {
    console.error('💥 BULK DELETE: Error removing contacts:', err);
    Alert.alert('Error', 'Failed to remove selected contacts');
  } finally {
    setBulkDeleting(false);
    setSelectedContacts([]);
    setMultiSelectMode(false);
  }
};

  
  const filteredContacts = contacts.filter(
    (contact) =>
      !searchQuery.includes('@') && (
        contact.contact_profile?.full_name
          ?.toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        contact.contact_profile?.email?.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading contacts...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.content, { paddingTop: insets.top }] }>
        <View style={styles.centeredContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>Contacts</Text>
          </View>

          <View style={styles.searchContainer}>
            <View style={styles.searchInputContainer}>
              <Search size={20} color={Colors.text.tertiary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search contacts or enter email..."
                placeholderTextColor={Colors.text.tertiary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>

          <ScrollView style={styles.scrollContent}>
            {readyToTalk === 'true' && (
              <View style={styles.callToActionContainer}>
                <MessageCircle size={32} color="#6366f1" />
                <Text style={styles.callToActionText}>
                  **Select a contact** to continue your conversation.
                </Text>
              </View>
            )}

            {mode === 'ai_chat' && (
              <View style={[styles.callToActionContainer, { backgroundColor: '#f0fdf4', borderLeftColor: '#10b981' }]}>
                <Bot size={32} color="#10b981" />
                <Text style={styles.callToActionText}>
                  Select a contact to start an AI-assisted conversation
                </Text>
              </View>
            )}

            {pendingInvites.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Pending Invites</Text>
                {pendingInvites.map((invite) => (
                  <View key={invite.id} style={styles.inviteCard}>
                    <View style={styles.contactInfo}>
                      <View style={styles.avatar}>
                        <UserPlus size={24} color="#f59e0b" />
                      </View>
                      <View style={styles.contactDetails}>
                        <Text style={styles.contactName}>
                          {invite.user_profile?.full_name || 'Unknown User'}
                        </Text>
                        <Text style={styles.contactEmail}>{invite.user_profile?.email}</Text>
                      </View>
                    </View>
                    <View style={styles.inviteActions}>
                      <TouchableOpacity
                        style={styles.acceptButton}
                        onPress={() => acceptInvite(invite)}
                      >
                        <Check size={16} color="#ffffff" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.rejectButton}
                        onPress={() => rejectInvite(invite)}
                      >
                        <X size={16} color="#ffffff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Show search results when searching by email in main search */}
            {searchQuery.includes('@') && searchResults.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Search Results</Text>
                {searchResults.map((profile) => (
                  <View key={profile.id} style={styles.resultCard}>
                    <View style={styles.contactInfo}>
                      <View style={styles.avatar}>
                        <UserCheck size={24} color="#6366f1" />
                      </View>
                      <View style={styles.contactDetails}>
                        <Text style={styles.contactName}>
                          {profile.full_name || 'Unknown User'}
                        </Text>
                        <Text style={styles.contactEmail}>{profile.email}</Text>
                      </View>
                    </View>
                    {renderSearchResultButton(profile)}
                  </View>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                My Contacts ({filteredContacts.length})
              </Text>

              {filteredContacts.length === 0 && !searchQuery.includes('@') ? (
                <View style={styles.emptyState}>
                  <Users size={48} color="#9ca3af" />
                  <Text style={styles.emptyTitle}>
                    {searchQuery && !searchQuery.includes('@') ? 'No contacts found' : 'No contacts yet'}
                  </Text>
                  <Text style={styles.emptyDescription}>
                    {searchQuery && !searchQuery.includes('@')
                      ? 'Try adjusting your search terms'
                      : 'Add contacts to start meaningful conversations'}
                  </Text>
                  {!searchQuery && (
                    <TouchableOpacity
                      style={styles.startButton}
                      onPress={() => setShowInviteModal(true)}
                    >
                      <UserPlus size={20} color="#ffffff" />
                      <Text style={styles.startButtonText}>Add First Contact</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                filteredContacts.map((contact) => (
                  <TouchableOpacity
                    key={contact.id}
                    style={[
                      styles.contactCard,
                      multiSelectMode && selectedContacts.includes(contact.id) && styles.selectedContactCard
                    ]}
                    onLongPress={() => handleLongPress(contact.id)}
                    onPress={() => multiSelectMode ? handleContactSelect(contact.id) : startChat(contact)}
                  >
                    <View style={styles.contactInfo}>
                      <View style={styles.avatar}>
                        <UserCheck size={24} color="#10b981" />
                      </View>
                      <View style={styles.contactDetails}>
                        <Text style={styles.contactName}>
                          {contact.contact_profile?.full_name || 'Unknown User'}
                        </Text>
                        <Text style={styles.contactEmail}>
                          {contact.contact_profile?.email}
                        </Text>
                      </View>
                    </View>
                    {!multiSelectMode && (
                      <TouchableOpacity onPress={() => startChat(contact)} style={styles.chatIconContainer}>
                        <MessageCircle size={24} color="#6366f1" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </View>

      {multiSelectMode && (
        <View style={styles.actionBar}>
          <Text style={styles.selectedCount}>
            {selectedContacts.length} selected
          </Text>
          <View style={styles.actionBarButtons}>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelMultiSelect}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirmBulkDelete}
              disabled={bulkDeleting || selectedContacts.length === 0}
            >
              <Text style={styles.deleteButtonText}>
                {bulkDeleting ? 'Removing...' : 'Remove'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal visible={showInviteModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => {
              setShowInviteModal(false);
              setInviteEmail('');
              setSearchResults([]);
            }}>
              <X size={24} color="#374151" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Contact</Text>
            <View style={styles.placeholder} />
          </View>

          <View style={styles.modalContent}>
            <View style={styles.searchSection}>
              <Text style={styles.inputLabel}>Search by email</Text>
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Enter email address..."
                value={inviteEmail}
                onChangeText={setInviteEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            {searching && (
              <View style={styles.searchingContainer}>
                <Text style={styles.searchingText}>Searching...</Text>
              </View>
            )}

            {!searching && inviteEmail.trim() && searchResults.length === 0 ? (
              <View style={styles.noResultsContainer}>
                <Text style={styles.noResultsText}>
                  No registered users found with that email
                </Text>
                <Text style={styles.noResultsSubtext}>
                  Send an invitation to join the app
                </Text>
                <TouchableOpacity
                  style={[styles.emailInviteButton, sendingEmailInvite && styles.inviteButtonDisabled]}
                  onPress={() => sendEmailInvite(inviteEmail)}
                  disabled={sendingEmailInvite}
                >
                  <Mail size={16} color="#ffffff" />
                </TouchableOpacity>
              </View>
            ) : null}

            {!searching && searchResults.length > 0 ? (
              <View style={styles.resultsSection}>
                <Text style={styles.resultsTitle}>Found Users</Text>
                {searchResults.map((profile) => (
                  <View key={profile.id} style={styles.resultCard}>
                    <View style={styles.contactInfo}>
                      <View style={styles.avatar}>
                        <UserCheck size={24} color="#6366f1" />
                      </View>
                      <View style={styles.contactDetails}>
                        <Text style={styles.contactName}>
                          {profile.full_name || 'Unknown User'}
                        </Text>
                        <Text style={styles.contactEmail}>{profile.email}</Text>
                      </View>
                    </View>
                    {renderSearchResultButton(profile)}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  selectedContactCard: {
    backgroundColor: '#e0e7ff',
    borderColor: '#6366f1',
    borderWidth: 2,
  },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceElevated,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    ...Shadows.medium,
  },
  actionBarButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  cancelButton: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    ...Shadows.small,
  },
  deleteButton: {
    backgroundColor: Colors.error[500],
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    ...Shadows.small,
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  selectedCount: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },

  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
  },
  centeredContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  header: {
    marginBottom: Spacing.md,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
  },
  title: {
    fontSize: Typography.fontSize['2xl'],
    fontWeight: Typography.fontWeight.bold,
    color: '#0288D1',
    textAlign: 'left',
    marginBottom: Spacing.lg,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: Spacing.lg,
    ...Shadows.small,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
  },
  scrollContent: {
    flex: 1,
    // Allow full page scrolling instead of capping height
    // Removing maxHeight to avoid half-visible list
    // Ensure ScrollView uses available space
    paddingBottom: Spacing.xl,
  },
  callToActionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderLeftWidth: 4,
    borderLeftColor: '#6366f1',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  callToActionText: {
    flex: 1,
    fontSize: Typography.fontSize.sm,
    color: '#374151',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: '#0288D1',
    marginBottom: Spacing.md,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.warning[50],
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.warning[200],
    ...Shadows.small,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  contactInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  contactDetails: {
    flex: 1,
  },
  contactName: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  contactEmail: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  acceptButton: {
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[600],
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  rejectButton: {
    backgroundColor: Colors.error[500],
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  emptyTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  emptyDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    marginBottom: Spacing.lg,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary[500],
    borderWidth: 3,
    borderColor: Colors.secondary[600],
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    gap: Spacing.xs,
    ...Shadows.small,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  placeholder: {
    width: 24,
  },
  modalContent: {
    flex: 1,
    padding: Spacing.lg,
  },
  searchSection: {
    marginBottom: Spacing.xl,
  },
  inputLabel: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  modalSearchInput: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
    ...Shadows.small,
  },
  searchingContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  searchingText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
  },
  resultsSection: {
    marginTop: Spacing.lg,
  },
  resultsTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  chatButton: {
    backgroundColor: Colors.success[500],
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  addContactButton: {
    backgroundColor: Colors.primary[500],
    borderWidth: 3,
    borderColor: Colors.secondary[600],
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  addContactButtonDisabled: {
    opacity: 0.6,
  },
  noResultsContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  noResultsText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  noResultsSubtext: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  emailInviteButton: {
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[600],
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  inviteButtonDisabled: {
    opacity: 0.6,
  },
  pendingButton: {
    backgroundColor: Colors.warning[100],
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  pendingText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.warning[700],
  },
  chatIconContainer: {
    padding: Spacing.sm,
  },
  cancelButtonText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  deleteButtonText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.inverse,
    fontWeight: Typography.fontWeight.semibold,
  },
});

export default ContactsScreen;