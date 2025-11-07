import React, { useEffect, useMemo, useState } from 'react';
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
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { Heart, Plus, CreditCard as Edit3, Trash2, Calendar, X } from 'lucide-react-native';

interface SoulroomEntry {
  id: string;
  title: string | null;
  content: string;
  mood: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

const MOOD_OPTIONS = [
  { value: 'happy', label: '😊 Happy', color: '#10b981' },
  { value: 'sad', label: '😢 Sad', color: '#3b82f6' },
  { value: 'angry', label: '😠 Angry', color: '#ef4444' },
  { value: 'anxious', label: '😰 Anxious', color: '#f59e0b' },
  { value: 'confused', label: '😕 Confused', color: '#8b5cf6' },
  { value: 'grateful', label: '🙏 Grateful', color: '#10b981' },
  { value: 'frustrated', label: '😤 Frustrated', color: '#f97316' },
  { value: 'peaceful', label: '😌 Peaceful', color: '#06b6d4' },
];

function SoulroomScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [entries, setEntries] = useState<SoulroomEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SoulroomEntry | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conversationStats, setConversationStats] = useState({ myTalks: 0, pendingAI: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchEntries();
    }
  }, [user]);

  const fetchConversationStats = async () => {
    if (!user?.id) return;
    try {
      setStatsLoading(true);

      const { data: myTalksData, error: myTalksError } = await supabase
        .from('chats')
        .select('id, context_data, is_resolved')
        .eq('user_id', user.id)
        .eq('chat_type', 'contact_chat')
        .eq('is_resolved', false);

      if (myTalksError) throw myTalksError;

      const myTalksCount = (myTalksData || []).filter((chat: any) => {
        const contextData = chat.context_data || {};
        return !(contextData && contextData.initial_pending);
      }).length;

      const { data: aiChatsData, error: aiChatsError } = await supabase
        .from('chats')
        .select('id')
        .eq('user_id', user.id)
        .eq('chat_type', 'ai_assistant')
        .eq('is_resolved', false);

      if (aiChatsError) throw aiChatsError;

      setConversationStats({
        myTalks: myTalksCount,
        pendingAI: aiChatsData?.length || 0,
      });
    } catch (error) {
      console.error('Error fetching conversation stats:', error);
    } finally {
      setStatsLoading(false);
    }
  };

  const fetchEntries = async () => {
    try {
      const { data, error } = await supabase
        .from('soulroom_entries')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEntries(data || []);
      await fetchConversationStats();
    } catch (error) {
      console.error('Error fetching entries:', error);
      Alert.alert('Error', 'Failed to load your entries');
    } finally {
      setLoading(false);
    }
  };

  const topMoodInfo = useMemo(() => {
    if (!entries.length) return null;
    const counts: Record<string, number> = {};
    entries.forEach((entry) => {
      if (!entry.mood) return;
      counts[entry.mood] = (counts[entry.mood] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;

    const topMoodKey = sorted[0][0];
    const option = MOOD_OPTIONS.find((m) => m.value === topMoodKey);
    return {
      label: option?.label || topMoodKey,
      color: option?.color || '#6366f1',
      count: sorted[0][1],
    };
  }, [entries]);

  const openNewEntry = () => {
    setEditingEntry(null);
    setTitle('');
    setContent('');
    setSelectedMood(null);
    setShowModal(true);
  };

  const openEditEntry = (entry: SoulroomEntry) => {
    setEditingEntry(entry);
    setTitle(entry.title || '');
    setContent(entry.content);
    setSelectedMood(entry.mood);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingEntry(null);
    setTitle('');
    setContent('');
    setSelectedMood(null);
  };

  const saveEntry = async () => {
    if (!content.trim()) {
      Alert.alert('Error', 'Please write your reflection');
      return;
    }

    setSaving(true);
    try {
      const entryData = {
        user_id: user?.id,
        title: title.trim() || null,
        content: content.trim(),
        mood: selectedMood,
        tags: null, // Can be enhanced later
      };

      if (editingEntry) {
        // Update existing entry
        const { error } = await supabase
          .from('soulroom_entries')
          .update(entryData)
          .eq('id', editingEntry.id);

        if (error) throw error;
      } else {
        // Create new entry
        const { error } = await supabase
          .from('soulroom_entries')
          .insert(entryData);

        if (error) throw error;
      }

      await fetchEntries();
      closeModal();
    } catch (error) {
      console.error('Error saving entry:', error);
      Alert.alert('Error', 'Failed to save your reflection');
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = (entry: SoulroomEntry) => {
    Alert.alert(
      'Delete Entry',
      'Are you sure you want to delete this reflection? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('soulroom_entries')
                .delete()
                .eq('id', entry.id);

              if (error) throw error;
              await fetchEntries();
            } catch (error) {
              console.error('Error deleting entry:', error);
              Alert.alert('Error', 'Failed to delete entry');
            }
          },
        },
      ]
    );
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) {
      return 'Today';
    } else if (diffInDays === 1) {
      return 'Yesterday';
    } else if (diffInDays < 7) {
      return `${diffInDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getMoodInfo = (mood: string | null) => {
    return MOOD_OPTIONS.find(option => option.value === mood);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading your reflections...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
  <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Soulroom</Text>
        <TouchableOpacity style={styles.addButton} onPress={openNewEntry}>
          <Plus size={24} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.entriesList} contentContainerStyle={styles.entriesContent}>
        <View style={styles.overviewCard}>
          <Text style={styles.sectionHeading}>Stay grounded before you talk</Text>
          <Text style={styles.overviewSubtitle}>
            Soulroom keeps your private reflections synced with every AI-assisted conversation.
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statBadge}>
              <Text style={styles.statValue}>{conversationStats.myTalks}</Text>
              <Text style={styles.statLabel}>Active My Talks</Text>
            </View>
            <View style={styles.statBadge}>
              <Text style={styles.statValue}>{conversationStats.pendingAI}</Text>
              <Text style={styles.statLabel}>AI Sessions Waiting</Text>
            </View>
            {topMoodInfo ? (
              <View style={[styles.statBadge, { borderColor: topMoodInfo.color }]}> 
                <Text style={[styles.statValue, { color: topMoodInfo.color }]}> 
                  {topMoodInfo.count}
                </Text>
                <Text style={styles.statLabel}>Most Logged Mood</Text>
                <Text style={[styles.moodBadgeLabel, { color: topMoodInfo.color }]}>{topMoodInfo.label}</Text>
              </View>
            ) : (
              <View style={styles.statBadge}>
                <Text style={styles.statValue}>{entries.length}</Text>
                <Text style={styles.statLabel}>Saved Reflections</Text>
              </View>
            )}
          </View>
          {statsLoading && (
            <Text style={styles.statHint}>Refreshing conversation stats…</Text>
          )}
          <View style={styles.quickActionsRow}>
            <TouchableOpacity style={styles.quickActionButton} onPress={openNewEntry}>
              <Text style={styles.quickActionText}>New Reflection</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionButton} onPress={() => router.push('/ai-assistant')}>
              <Text style={styles.quickActionText}>Plan with AI Assistant</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionButton} onPress={() => router.push('/(tabs)/chats')}>
              <Text style={styles.quickActionText}>Open My Talks</Text>
            </TouchableOpacity>
          </View>
        </View>

        {entries.length === 0 ? (
          <View style={styles.emptyState}>
            <Heart size={48} color="#ef4444" />
            <Text style={styles.emptyTitle}>Your personal space</Text>
            <Text style={styles.emptyDescription}>
              Start reflecting on your emotions and track your wellness journey
            </Text>
            <TouchableOpacity style={styles.startButton} onPress={openNewEntry}>
              <Plus size={20} color="#ffffff" />
              <Text style={styles.startButtonText}>Write First Reflection</Text>
            </TouchableOpacity>
          </View>
        ) : (
          entries.map((entry) => {
            const moodInfo = getMoodInfo(entry.mood);
            const contactTag = entry.tags?.find((tag) => tag.startsWith('contact:')) || null;
            const contactIdFromTag = contactTag ? contactTag.split(':')[1] : null;
            const displayTags = (entry.tags || []).map((tag) => {
              if (tag.startsWith('contact:')) {
                return 'Linked contact';
              }
              if (tag === 'pre_conversation') return 'Pre-conversation';
              if (tag === 'closure') return 'Closure saved';
              return tag.replace(/_/g, ' ');
            });
            return (
              <View key={entry.id} style={styles.entryCard}>
                <View style={styles.entryHeader}>
                  <View style={styles.entryInfo}>
                    {entry.title && (
                      <Text style={styles.entryTitle}>{entry.title}</Text>
                    )}
                    <View style={styles.entryMeta}>
                      <Calendar size={14} color="#9ca3af" />
                      <Text style={styles.entryDate}>{formatDate(entry.created_at)}</Text>
                      {moodInfo && (
                        <>
                          <Text style={styles.metaSeparator}>•</Text>
                          <Text style={[styles.entryMood, { color: moodInfo.color }]}>
                            {moodInfo.label}
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                  <View style={styles.entryActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => openEditEntry(entry)}
                    >
                      <Edit3 size={16} color="#6b7280" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => deleteEntry(entry)}
                    >
                      <Trash2 size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.entryContent} numberOfLines={3}>
                  {entry.content}
                </Text>
                {displayTags.length > 0 && (
                  <View style={styles.entryTagRow}>
                    {displayTags.map((label, idx) => (
                      <View key={`${entry.id}-tag-${idx}`} style={styles.tagChip}>
                        <Text style={styles.tagChipText}>{label}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {contactIdFromTag && (
                  <View style={styles.entryActionRow}>
                    <TouchableOpacity
                      style={styles.entryActionButton}
                      onPress={() => router.push(`/ai-assistant?contactId=${contactIdFromTag}`)}
                    >
                      <Text style={styles.entryActionButtonText}>Plan next conversation</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.entryActionButtonSecondary}
                      onPress={() => router.push('/(tabs)/chats')}
                    >
                      <Text style={styles.entryActionButtonSecondaryText}>View My Talks</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeModal}>
              <X size={24} color="#374151" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingEntry ? 'Edit Reflection' : 'New Reflection'}
            </Text>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={saveEntry}
              disabled={saving}
            >
              <Text style={styles.saveButtonText}>
                {saving ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>Title (Optional)</Text>
              <TextInput
                style={styles.titleInput}
                value={title}
                onChangeText={setTitle}
                placeholder="Give your reflection a title..."
                maxLength={100}
              />
            </View>

            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>How are you feeling?</Text>
              <View style={styles.moodGrid}>
                {MOOD_OPTIONS.map((mood) => (
                  <TouchableOpacity
                    key={mood.value}
                    style={[
                      styles.moodOption,
                      selectedMood === mood.value && styles.moodOptionSelected,
                      selectedMood === mood.value && { borderColor: mood.color },
                    ]}
                    onPress={() => setSelectedMood(mood.value)}
                  >
                    <Text style={styles.moodText}>{mood.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>Your Reflection</Text>
              <TextInput
                style={styles.contentInput}
                value={content}
                onChangeText={setContent}
                placeholder="What's on your mind? How are you feeling? What happened today that you want to reflect on?"
                multiline
                textAlignVertical="top"
                maxLength={2000}
              />
              <Text style={styles.characterCount}>
                {content.length}/2000 characters
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
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
    fontSize: 16,
    color: '#6b7280',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  entriesList: {
    flex: 1,
  },
  entriesContent: {
    padding: 16,
    gap: 16,
  },
  overviewCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.medium,
  },
  sectionHeading: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  overviewSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    flexWrap: 'wrap',
    marginBottom: Spacing.md,
  },
  statBadge: {
    flex: 1,
    minWidth: 110,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    ...Shadows.small,
  },
  statValue: {
    fontSize: Typography.fontSize['2xl'],
    fontWeight: Typography.fontWeight.bold,
    color: Colors.primary[600],
  },
  statLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  moodBadgeLabel: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    marginTop: 2,
  },
  statHint: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    marginBottom: Spacing.md,
  },
  quickActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  quickActionButton: {
    flexGrow: 1,
    minWidth: 160,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[600],
    ...Shadows.small,
  },
  quickActionText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 100,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary[500],
    borderWidth: 3,
    borderColor: Colors.secondary[600],
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    ...Shadows.small,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  entryCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.medium,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  entryInfo: {
    flex: 1,
  },
  entryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  entryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  entryDate: {
    fontSize: 12,
    color: '#9ca3af',
  },
  metaSeparator: {
    fontSize: 12,
    color: '#d1d5db',
  },
  entryMood: {
    fontSize: 12,
    fontWeight: '500',
  },
  entryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
  },
  entryContent: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  entryTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: Spacing.sm,
  },
  tagChip: {
    backgroundColor: Colors.primary[50],
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.primary[100],
  },
  tagChipText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.medium,
  },
  entryActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  entryActionButton: {
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[600],
    ...Shadows.small,
  },
  entryActionButtonText: {
    color: '#FFFFFF',
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },
  entryActionButtonSecondary: {
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  entryActionButtonSecondaryText: {
    color: Colors.text.secondary,
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  saveButton: {
    backgroundColor: Colors.primary[500],
    borderWidth: 3,
    borderColor: Colors.secondary[600],
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    ...Shadows.small,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  inputSection: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.fontSize.base,
    backgroundColor: Colors.surface,
    color: Colors.text.primary,
    ...Shadows.small,
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moodOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
  },
  moodOptionSelected: {
    borderWidth: 2,
    backgroundColor: '#f0f9ff',
  },
  moodText: {
    fontSize: 14,
    color: '#374151',
  },
  contentInput: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.fontSize.base,
    backgroundColor: Colors.surface,
    color: Colors.text.primary,
    minHeight: 120,
    ...Shadows.small,
  },
  characterCount: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 4,
  },
});

export default SoulroomScreen;