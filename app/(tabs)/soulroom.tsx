import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from '@/contexts/AuthContext';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { Heart, Plus, CreditCard as Edit3, Trash2, Calendar, X, Sparkles, Mic, Square, Play, Pause, Share2 } from 'lucide-react-native';
import MoodTrendChart, { MoodTrendPoint } from '@/components/MoodTrendChart';

interface SoulroomEntry {
  id: string;
  title: string | null;
  content: string;
  mood: string | null;
  tags: string[] | null;
  ai_summary?: string | null;
  emotion_tag?: string | null;
  transcript?: string | null;
  emotion_keywords?: string[] | null;
  created_at: string;
  updated_at: string;
}

interface CoachNudge {
  headline: string;
  message: string;
  prompts: string[];
  generated_week: string;
}

interface GrowthDigest {
  topEmotion: string | null;
  topEmotionLabel: string | null;
  positiveWord: string | null;
  contactId: string | null;
  contactLabel: string | null;
  entryCount: number;
}

type ContactOption = {
  id: string;
  label: string;
  category?: string | null;
};

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

const MOOD_INTENSITY: Record<string, number> = {
  joyful: 4,
  happy: 4,
  calm: 3,
  grateful: 3,
  peaceful: 3,
  relieved: 3,
  reflective: 2,
  neutral: 2,
  confused: 2,
  sad: 4,
  anxious: 4,
  angry: 5,
  overwhelmed: 5,
  frustrated: 4,
};

const MOOD_ACCENTS: Record<string, string> = {
  joyful: '#f59e0b',
  happy: '#f59e0b',
  calm: '#3b82f6',
  grateful: '#10b981',
  peaceful: '#06b6d4',
  relieved: '#14b8a6',
  reflective: '#6366f1',
  neutral: '#94a3b8',
  confused: '#8b5cf6',
  sad: '#1d4ed8',
  anxious: '#f97316',
  angry: '#ef4444',
  overwhelmed: '#a855f7',
  frustrated: '#f97316',
};

const EMOTION_EMOJI: Record<string, string> = {
  calm: '😌',
  grateful: '🙏',
  relieved: '😮‍💨',
  joyful: '😊',
  happy: '😊',
  sad: '😢',
  angry: '😠',
  anxious: '😰',
  overwhelmed: '😵',
  reflective: '🪞',
  neutral: '🙂',
  peaceful: '🕊️',
};

const POSITIVE_WORDS = [
  'grateful',
  'appreciate',
  'calm',
  'peaceful',
  'proud',
  'hopeful',
  'supported',
  'connected',
  'joy',
  'care',
  'kind',
  'steady',
  'soft',
  'comfort',
  'relief',
  'growth',
  'balance',
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
  const [coachNudge, setCoachNudge] = useState<CoachNudge | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [contactLookup, setContactLookup] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactPickerVisible, setContactPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<'link' | 'share'>('link');
  const [pendingShareMessage, setPendingShareMessage] = useState<string | null>(null);
  const [linkedContactId, setLinkedContactId] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState<any>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [voiceStoragePath, setVoiceStoragePath] = useState<string | null>(null);
  const [voiceKeywords, setVoiceKeywords] = useState<string[]>([]);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [voicePlaybackUrls, setVoicePlaybackUrls] = useState<Record<string, string>>({});
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const playbackRef = useRef<any>(null);

  useEffect(() => {
    if (user) {
      fetchEntries();
    }
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        setContactsLoading(true);
        const { data, error } = await supabase
          .from('contacts')
          .select(`
            contact_id,
            category,
            contact_profile:profiles!contacts_contact_id_fkey (
              id,
              full_name,
              email
            )
          `)
          .eq('user_id', user.id);
        if (cancelled) return;
        if (!error && Array.isArray(data)) {
          const options: ContactOption[] = data.map((item: any) => {
            const profile = Array.isArray(item.contact_profile)
              ? item.contact_profile[0]
              : item.contact_profile;
            const label = profile?.full_name || profile?.email || 'Contact';
            return {
              id: profile?.id,
              label,
              category: item.category || null,
            };
          }).filter((option) => option.id);
          setContacts(options);
          setContactLookup((prev) => {
            const next = { ...prev };
            options.forEach((option) => {
              if (option.id) {
                next[option.id] = option.label;
              }
            });
            return next;
          });
        }
      } finally {
        if (!cancelled) {
          setContactsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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

  useEffect(() => {
    if (!entries.length || !user?.id) {
      return;
    }

    const referencedIds = new Set<string>();
    entries.forEach((entry) => {
      (entry.tags || []).forEach((tag) => {
        if (tag.startsWith('contact:')) {
          const contactId = tag.split(':')[1];
          if (contactId) {
            referencedIds.add(contactId);
          }
        }
      });
    });

    const missing = Array.from(referencedIds).filter((id) => !contactLookup[id]);
    if (!missing.length) {
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, email')
        .in('id', missing);

      if (!cancelled && !error && data) {
        setContactLookup((prev) => {
          const next = { ...prev };
          data.forEach((contact) => {
            next[contact.id] = contact.full_name || contact.email || 'Contact';
          });
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entries, user?.id, contactLookup]);

  useEffect(() => {
    let cancelled = false;

    const loadVoiceUrls = async () => {
      const entriesWithVoice = entries
        .map((entry) => ({ entry, voicePath: getVoicePathFromEntry(entry) }))
        .filter(({ voicePath }) => Boolean(voicePath));
      if (!entriesWithVoice.length) {
        if (!cancelled) {
          setVoicePlaybackUrls((prev) => {
            if (Object.keys(prev).length === 0) {
              return prev;
            }
            return {};
          });
        }
        return;
      }

      const updates: Record<string, string> = {};

      for (const { entry, voicePath } of entriesWithVoice) {
        if (!voicePath || voicePlaybackUrls[entry.id]) {
          continue;
        }
        const { data, error } = await supabase
          .storage
          .from('voice_journal')
          .createSignedUrl(voicePath, 60 * 60);
        if (!cancelled && !error && data?.signedUrl) {
          updates[entry.id] = data.signedUrl;
        }
      }

      if (!cancelled && Object.keys(updates).length) {
        setVoicePlaybackUrls((prev) => {
          const next = { ...prev, ...updates };
          return next;
        });
      }
    };

    loadVoiceUrls();

    return () => {
      cancelled = true;
    };
  }, [entries, voicePlaybackUrls]);

  useEffect(() => {
    return () => {
      if (playbackRef.current) {
        playbackRef.current.unloadAsync().catch(() => undefined);
        playbackRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!user?.id || !entries.length) {
      return;
    }

    const nudgeKey = entries[0]?.updated_at;
    if (!nudgeKey) {
      return;
    }

    let cancelled = false;
    setCoachLoading(true);
    setCoachError(null);

    supabase.functions
      .invoke('generate-coach-nudge', {
        body: {
          userId: user.id,
        },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Coach nudge error', error);
          setCoachError('Unable to load this week\'s coach note');
          setCoachNudge(null);
        } else if (data) {
          setCoachNudge(data as CoachNudge);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Coach nudge fetch failure', err);
          setCoachError('Unable to load this week\'s coach note');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCoachLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, entries]);

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

  const growthDigest = useMemo<GrowthDigest | null>(() => {
    if (!entries.length) return null;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    const weekly = entries.filter((entry) => new Date(entry.created_at) >= cutoff);
    if (!weekly.length) return null;

    const emotionCounts: Record<string, number> = {};
    const contactCounts: Record<string, number> = {};
    const wordCounts: Record<string, number> = {};

    weekly.forEach((entry) => {
      const emotionKey = (entry.emotion_tag || entry.mood || '').toLowerCase();
      if (emotionKey) {
        emotionCounts[emotionKey] = (emotionCounts[emotionKey] || 0) + 1;
      }

      (entry.tags || []).forEach((tag) => {
        if (tag.startsWith('contact:')) {
          const contactId = tag.split(':')[1];
          if (contactId) {
            contactCounts[contactId] = (contactCounts[contactId] || 0) + 1;
          }
        }
      });

      const text = `${entry.content} ${entry.ai_summary ?? ''}`.toLowerCase();
      POSITIVE_WORDS.forEach((word) => {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        const matches = text.match(regex);
        if (matches) {
          wordCounts[word] = (wordCounts[word] || 0) + matches.length;
        }
      });
    });

    const pickTop = (counts: Record<string, number>) => {
      const entriesList = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return entriesList.length ? entriesList[0][0] : null;
    };

    const topEmotion = pickTop(emotionCounts);
    const topPositiveWord = pickTop(wordCounts);
    const topContactId = pickTop(contactCounts);

    const moodOption = topEmotion ? MOOD_OPTIONS.find((m) => m.value === topEmotion) : null;

    return {
      topEmotion,
      topEmotionLabel: topEmotion
        ? `${EMOTION_EMOJI[topEmotion] || ''} ${moodOption?.label || topEmotion}`.trim()
        : null,
      positiveWord: topPositiveWord,
      contactId: topContactId,
      contactLabel: topContactId ? (contactLookup[topContactId] || 'Someone you care about') : null,
      entryCount: weekly.length,
    };
  }, [entries, contactLookup]);

  const handleShareDigest = useCallback(() => {
    if (!growthDigest) return;
    const summaryLines: string[] = [];
    if (growthDigest.topEmotionLabel) {
      summaryLines.push(`This week felt ${growthDigest.topEmotionLabel}.`);
    }
    if (growthDigest.positiveWord) {
      summaryLines.push(`I kept returning to the word "${growthDigest.positiveWord}" in my reflections.`);
    }
    if (growthDigest.contactLabel) {
      summaryLines.push(`You showed up often in my journals, and I want to share that with care.`);
    }

    const digestMessage = summaryLines.join(' ');
    const narrative = digestMessage || 'I noticed shifts in my mood this week and want help expressing them gently.';

    const prefill = encodeURIComponent(`Here is my weekly mood digest. ${narrative}`);

    if (growthDigest.contactId) {
      router.push({
        pathname: '/ai-chat',
        params: {
          prefillDescription: prefill,
          mode: 'new',
          contactId: growthDigest.contactId,
        },
      });
      return;
    }

    if (contacts.length) {
      setPickerMode('share');
      setPendingShareMessage(prefill);
      setContactPickerVisible(true);
    } else {
      Alert.alert(
        'No contacts yet',
        'Link at least one reflection to a contact before sharing the digest. You can do this inside the reflection details.',
      );
    }
  }, [growthDigest, contacts, router]);

  const summarizeReflection = async (entryId: string, reflectionText: string) => {
    if (!user?.id) return;
    try {
      await supabase.functions.invoke('analyze-reflection', {
        body: {
          entryId,
          userId: user.id,
          text: reflectionText,
        },
      });
    } catch (error) {
      console.error('Error generating AI summary:', error);
    }
  };

  const saveEntry = async () => {
    if (!content.trim()) {
      Alert.alert('Error', 'Please write your reflection');
      return;
    }

    if (voiceMode) {
      if (processingVoice) {
        Alert.alert('Voice reflection', 'Please wait while we finish processing your recording.');
        return;
      }
      if (!voiceStoragePath) {
        Alert.alert('Voice reflection', 'Finish your recording before saving.');
        return;
      }
    }

    setSaving(true);
    try {
      const baseTags = Array.isArray(editingEntry?.tags)
        ? editingEntry.tags.filter((tag) =>
            typeof tag === 'string' &&
            !tag.startsWith('voice:') &&
            !tag.startsWith('mood:') &&
            !tag.startsWith('contact:')
          )
        : [];
      const entryData: any = {
        user_id: user?.id,
        title: title.trim() || null,
        content: content.trim(),
        mood: selectedMood,
        tags: [...baseTags],
      };

      if (voiceMode && voiceStoragePath) {
        entryData.tags = [...entryData.tags, `voice:${voiceStoragePath}`];
      }
      if (voiceMode && voiceKeywords.length) {
        entryData.tags = [
          ...entryData.tags,
          ...voiceKeywords.map((word) => `mood:${word}`),
        ];
      }
      if (linkedContactId) {
        entryData.tags = [...entryData.tags, `contact:${linkedContactId}`];
      }

      entryData.tags = entryData.tags.length
        ? Array.from(new Set(entryData.tags))
        : null;
      let targetEntryId: string | null = editingEntry?.id ?? null;

      if (editingEntry) {
        const { error } = await supabase
          .from('soulroom_entries')
          .update({ ...entryData, ai_summary: null, emotion_tag: voiceMode ? selectedMood : null })
          .eq('id', editingEntry.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('soulroom_entries')
          .insert(entryData)
          .select('id')
          .single();

        if (error) throw error;
        targetEntryId = data?.id ?? null;
      }

      if (targetEntryId) {
        try {
          await summarizeReflection(targetEntryId, entryData.content);
        } catch (summaryError) {
          console.error('Summary generation failed:', summaryError);
        }
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

  const resetVoiceState = useCallback(() => {
    setVoiceMode(false);
    setRecording(null);
    setRecordingUri(null);
    setVoiceStoragePath(null);
    setVoiceKeywords([]);
    setProcessingVoice(false);
  }, []);

const getVoicePathFromEntry = (entry: SoulroomEntry): string | null => {
  if (!Array.isArray(entry.tags)) return null;
  const voiceTag = entry.tags.find((tag) => typeof tag === 'string' && tag.startsWith('voice:'));
  return voiceTag ? voiceTag.replace(/^voice:/, '') : null;
};

const getStoredVoiceKeywords = (entry: SoulroomEntry): string[] => {
  if (Array.isArray(entry.emotion_keywords) && entry.emotion_keywords.length) {
    return entry.emotion_keywords;
  }
  if (Array.isArray(entry.tags)) {
    return entry.tags
      .filter((tag) => typeof tag === 'string' && tag.startsWith('mood:'))
      .map((tag) => tag.replace(/^mood:/, '').replace(/_/g, ' '))
      .filter((tag) => tag.trim().length > 0);
  }
  return [];
};

const getLinkedContactId = (entry: SoulroomEntry): string | null => {
  if (!Array.isArray(entry.tags)) return null;
  const contactTag = entry.tags.find((tag) => typeof tag === 'string' && tag.startsWith('contact:'));
  return contactTag ? contactTag.split(':')[1] || null : null;
};

const base64CharToInt = (char: string | undefined) => {
  if (!char) return 0;
  if (char === '=') return 0;
  const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const index = map.indexOf(char);
  return index < 0 ? 0 : index;
};

const base64ToUint8Array = (base64: string) => {
  const sanitized = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < sanitized.length; i += 4) {
    const chunk =
      (base64CharToInt(sanitized[i]) << 18) |
      (base64CharToInt(sanitized[i + 1]) << 12) |
      (base64CharToInt(sanitized[i + 2]) << 6) |
      base64CharToInt(sanitized[i + 3]);
    bytes.push((chunk >> 16) & 0xff);
    if (sanitized[i + 2] !== '=' && sanitized[i + 2] !== undefined) {
      bytes.push((chunk >> 8) & 0xff);
    }
    if (sanitized[i + 3] !== '=' && sanitized[i + 3] !== undefined) {
      bytes.push(chunk & 0xff);
    }
  }
  return Uint8Array.from(bytes);
};

  const processVoiceFile = useCallback(async (uri: string) => {
    if (!user?.id) return;
    setProcessingVoice(true);
    try {
      const fileName = `${user.id}/${Date.now()}.m4a`;
      const base64Data = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });
      const audioBuffer = base64ToUint8Array(base64Data).buffer;

      const upload = await supabase.storage
        .from('voice_journal')
        .upload(fileName, audioBuffer, {
          contentType: 'audio/m4a',
          upsert: false,
        });

      if (upload.error) {
        throw upload.error;
      }

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      const { data, error } = await supabase.functions.invoke('voice-reflection', {
        body: {
          audioBase64: base64Data,
          mimeType: 'audio/m4a',
        },
      });

      if (error) {
        throw error;
      }

      const transcript = (data?.transcript as string) || '';
      const keywords = Array.isArray(data?.keywords) ? data.keywords as string[] : [];
      const moodFromVoice = typeof data?.mood === 'string' ? (data.mood as string) : null;

      setVoiceMode(true);
      setVoiceStoragePath(fileName);
      if (transcript) {
        setContent(transcript);
      }
      setVoiceKeywords(keywords);
      if (moodFromVoice && !selectedMood) {
        setSelectedMood(moodFromVoice);
      }
    } catch (error) {
      console.error('Voice processing failed', error);
      Alert.alert('Voice reflection', 'We could not process that recording. Please try again.');
      setVoiceMode(false);
      setVoiceStoragePath(null);
    } finally {
      setProcessingVoice(false);
    }
  }, [user?.id, supabase, selectedMood]);

  const startRecording = useCallback(async () => {
    if (recording) {
      return;
    }
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone access needed', 'Please allow microphone access to record reflections.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();
      setRecording(newRecording);
    } catch (error) {
      console.error('Failed to start recording', error);
      Alert.alert('Recording error', 'Could not start recording. Please try again.');
    }
  }, [recording]);

  const stopRecording = useCallback(async () => {
    if (!recording) {
      return;
    }
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      if (uri) {
        setRecordingUri(uri);
        await processVoiceFile(uri);
      }
    } catch (error) {
      console.error('Failed to stop recording', error);
      Alert.alert('Recording error', 'We had trouble finishing the recording.');
    }
  }, [recording, processVoiceFile]);

  const togglePlaybackForEntry = useCallback(async (entryId: string, uri: string) => {
    try {
      if (currentlyPlayingId === entryId && playbackRef.current) {
        await playbackRef.current.stopAsync();
        await playbackRef.current.unloadAsync();
        playbackRef.current = null;
        setCurrentlyPlayingId(null);
        return;
      }

      if (playbackRef.current) {
        await playbackRef.current.stopAsync();
        await playbackRef.current.unloadAsync();
        playbackRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync({ uri });
      playbackRef.current = sound;
      setCurrentlyPlayingId(entryId);

      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          sound.unloadAsync().catch(() => undefined);
          if (playbackRef.current === sound) {
            playbackRef.current = null;
          }
          setCurrentlyPlayingId(null);
        }
      });

      await sound.playAsync();
    } catch (error) {
      console.error('Playback failed', error);
      Alert.alert('Playback error', 'Unable to play this audio reflection.');
      setCurrentlyPlayingId(null);
    }
  }, [currentlyPlayingId]);

  const previewRecording = useCallback(async () => {
    if (!recordingUri) return;
    try {
      if (playbackRef.current) {
        await playbackRef.current.stopAsync();
        await playbackRef.current.unloadAsync();
        playbackRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri: recordingUri });
      playbackRef.current = sound;
      await sound.playAsync();
    } catch (error) {
      console.error('Preview playback failed', error);
      Alert.alert('Playback error', 'Unable to preview this recording.');
    }
  }, [recordingUri]);

  const openNewEntry = () => {
    setEditingEntry(null);
    setTitle('');
    setContent('');
    setSelectedMood(null);
    setLinkedContactId(null);
    resetVoiceState();
    setShowModal(true);
  };

  const openEditEntry = (entry: SoulroomEntry) => {
    setEditingEntry(entry);
    setTitle(entry.title || '');
    setContent(entry.content);
    setSelectedMood(entry.mood);
    const voicePath = getVoicePathFromEntry(entry);
    setVoiceMode(Boolean(voicePath));
    setVoiceStoragePath(voicePath);
    setVoiceKeywords(getStoredVoiceKeywords(entry));
    setLinkedContactId(getLinkedContactId(entry));
    setRecordingUri(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingEntry(null);
    setTitle('');
    setContent('');
    setSelectedMood(null);
    setLinkedContactId(null);
    resetVoiceState();
  };

  const timelineData: MoodTrendPoint[] = useMemo(() => {
    const sorted = [...entries]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(-21);

    return sorted.map((entry) => {
      const moodKey = (entry.mood || entry.emotion_tag || 'neutral').toLowerCase();
      const intensity = MOOD_INTENSITY[moodKey] ?? 2;
      const accent = MOOD_ACCENTS[moodKey] ?? '#6366f1';
      const date = new Date(entry.created_at);
      const chatTag = entry.tags?.find((tag) => tag.startsWith('chat:'));
      const chatId = chatTag ? chatTag.split(':')[1] : null;

      return {
        id: entry.id,
        dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
        mood: entry.mood || entry.emotion_tag || 'Neutral',
        intensity,
        accent,
        chatId,
      };
    });
  }, [entries]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading your reflections...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSelectPoint = (point: MoodTrendPoint) => {
    if (point.chatId) {
      router.push(`/contact-chat?chatId=${point.chatId}&isOngoing=true`);
      return;
    }
    Alert.alert('Mood snapshot', `${point.dateLabel}: ${point.mood}`);
  };

  return (
  <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Soulroom</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => {
          setEditingEntry(null);
          setTitle('');
          setContent('');
          setSelectedMood(null);
          setLinkedContactId(null);
          resetVoiceState();
          setShowModal(true);
        }}>
          <Plus size={24} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.entriesList} contentContainerStyle={styles.entriesContent}>
        {timelineData.length > 0 ? (
          <View style={styles.timelineCard}>
            <View style={styles.timelineHeader}>
              <Text style={styles.sectionTitle}>Mood Trend</Text>
              <Text style={styles.timelineHint}>Tap a point to see what was happening</Text>
            </View>
            <MoodTrendChart data={timelineData} onSelectPoint={handleSelectPoint} />
          </View>
        ) : null}
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

        <View style={styles.coachCardWrapper}>
          {coachLoading ? (
            <View style={styles.coachCard}> 
              <ActivityIndicator color={Colors.primary[500]} />
              <Text style={styles.coachHeadline}>Gathering your weekly nudge…</Text>
            </View>
          ) : coachNudge ? (
            <View style={styles.coachCard}>
              <View style={styles.coachHeader}>
                <Sparkles size={18} color={Colors.primary[600]} />
                <Text style={styles.coachHeadline}>{coachNudge.headline}</Text>
              </View>
              <Text style={styles.coachMessage}>{coachNudge.message}</Text>
              {coachNudge.prompts?.length ? (
                <View style={styles.coachPromptList}>
                  {coachNudge.prompts.map((prompt, idx) => (
                    <Text key={`prompt-${idx}`} style={styles.coachPrompt}>
                      • {prompt}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : coachError ? (
            <View style={styles.coachCard}>
              <Text style={styles.coachHeadline}>We\'ll try again soon</Text>
              <Text style={styles.coachMessage}>{coachError}</Text>
            </View>
          ) : null}
        </View>

        {growthDigest ? (
          <View style={styles.digestCard}>
            <View style={styles.digestHeader}>
              <Text style={styles.sectionTitle}>Weekly Mood Digest</Text>
              <Text style={styles.digestSubhead}>Last {growthDigest.entryCount} reflections</Text>
            </View>
            <View style={styles.digestRow}>
              <Text style={styles.digestLabel}>Dominant emotion</Text>
              <Text style={styles.digestValue}>{growthDigest.topEmotionLabel || 'Still observing'}</Text>
            </View>
            <View style={styles.digestRow}>
              <Text style={styles.digestLabel}>Word you leaned on</Text>
              <Text style={styles.digestValue}>{growthDigest.positiveWord || '—'}</Text>
            </View>
            <View style={styles.digestRow}>
              <Text style={styles.digestLabel}>Contact on your mind</Text>
              <Text style={styles.digestValue}>{growthDigest.contactLabel || 'Keeping it private'}</Text>
            </View>
            <TouchableOpacity style={styles.shareButton} onPress={handleShareDigest}>
              <Share2 size={16} color={Colors.primary[700]} />
              <Text style={styles.shareButtonText}>
                {growthDigest.contactLabel
                  ? `Help me express this to ${growthDigest.contactLabel}`
                  : 'Help me express this with AI'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
 
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
            const displayTags = (entry.tags || [])
              .map((tag) => {
                if (tag.startsWith('contact:')) {
                  const contactIdFromTag = tag.split(':')[1];
                  if (contactIdFromTag) {
                    return contactLookup[contactIdFromTag] || 'Linked contact';
                  }
                  return null;
                }
                if (tag === 'pre_conversation') return 'Pre-conversation';
                if (tag === 'closure') return 'Closure saved';
                if (tag.startsWith('voice:')) return null;
                if (tag.startsWith('mood:')) return null;
                return tag.replace(/_/g, ' ');
              })
              .filter((label): label is string => Boolean(label));
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
                {entry.ai_summary ? (
                  <View style={styles.summaryCard}>
                    <View style={styles.summaryHeader}>
                      <Sparkles size={14} color={Colors.primary[600]} />
                      <Text style={styles.summaryTitle}>AI Reflection Summary</Text>
                      {entry.emotion_tag ? (
                        <Text style={styles.summaryChip}>{entry.emotion_tag}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.summaryBody}>{entry.ai_summary}</Text>
                  </View>
                ) : null}
                {(() => {
                  const voicePath = getVoicePathFromEntry(entry);
                  if (!voicePath) {
                    return null;
                  }
                  const playbackUri = voicePlaybackUrls[entry.id];
                  const keywords = getStoredVoiceKeywords(entry);
                  return (
                  <View style={styles.voiceCard}>
                    <TouchableOpacity
                      style={[styles.voiceButton, !playbackUri && styles.voiceButtonDisabled]}
                      onPress={() => {
                        if (playbackUri) {
                          togglePlaybackForEntry(entry.id, playbackUri);
                        }
                      }}
                      disabled={!playbackUri}
                    >
                      {currentlyPlayingId === entry.id ? (
                        <Pause size={16} color={Colors.primary[700]} />
                      ) : playbackUri ? (
                        <Play size={16} color={Colors.primary[700]} />
                      ) : (
                        <ActivityIndicator size="small" color={Colors.primary[500]} />
                      )}
                      <Text style={styles.voiceButtonText}>
                        {currentlyPlayingId === entry.id ? 'Pause voice note' : 'Play voice note'}
                      </Text>
                    </TouchableOpacity>
                    {keywords.length ? (
                      <View style={styles.keywordRow}>
                        {keywords.slice(0, 4).map((keyword, idx) => (
                          <View key={`${entry.id}-keyword-${idx}`} style={styles.keywordChip}>
                            <Text style={styles.keywordChipText}>{keyword}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  );
                })()}
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
            <TouchableOpacity onPress={() => setShowModal(false)}>
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
              <Text style={styles.inputLabel}>Reflection input</Text>
              <View style={styles.modeToggleRow}>
                <TouchableOpacity
                  style={[styles.modeToggle, !voiceMode && styles.modeToggleActive]}
                  onPress={() => {
                    setVoiceMode(false);
                    setVoiceStoragePath(null);
                    setRecordingUri(null);
                    setVoiceKeywords([]);
                  }}
                >
                  <Text style={!voiceMode ? styles.modeToggleTextActive : styles.modeToggleText}>Type</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeToggle, voiceMode && styles.modeToggleActive]}
                  onPress={() => {
                    setVoiceMode(true);
                  }}
                >
                  <Text style={voiceMode ? styles.modeToggleTextActive : styles.modeToggleText}>Voice</Text>
                </TouchableOpacity>
              </View>
            </View>

            {voiceMode ? (
              <View style={styles.voiceCaptureCard}>
                <Text style={styles.voiceHint}>Record a short message—AI will turn it into text you can tweak.</Text>
                <View style={styles.voiceControls}>
                  <TouchableOpacity
                    style={[styles.recordButton, recording && styles.recordButtonActive]}
                    onPress={recording ? stopRecording : startRecording}
                  >
                    {recording ? (
                      <Square size={18} color="#ffffff" />
                    ) : (
                      <Mic size={18} color="#ffffff" />
                    )}
                    <Text style={styles.recordButtonText}>
                      {recording ? 'Tap to stop' : 'Tap to record'}
                    </Text>
                  </TouchableOpacity>
                  {recordingUri ? (
                    <TouchableOpacity style={styles.previewButton} onPress={previewRecording}>
                      <Play size={16} color={Colors.primary[700]} />
                      <Text style={styles.previewButtonText}>Listen back</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {processingVoice ? (
                  <View style={styles.processingRow}>
                    <ActivityIndicator size="small" color={Colors.primary[600]} />
                    <Text style={styles.processingText}>Transcribing your reflection…</Text>
                  </View>
                ) : null}
                {voiceKeywords.length ? (
                  <View style={styles.keywordRow}>
                    {voiceKeywords.slice(0, 4).map((keyword, idx) => (
                      <View key={`voice-keyword-${idx}`} style={styles.keywordChip}>
                        <Text style={styles.keywordChipText}>{keyword}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>Link to contact (optional)</Text>
              <View style={styles.contactQuickActions}>
                <TouchableOpacity
                  style={
                    linkedContactId
                      ? styles.smallPillButtonActive
                      : styles.smallPillButtonSecondary
                  }
                  onPress={() => {
                    setPickerMode('link');
                    setContactPickerVisible(true);
                  }}
                >
                  <Text
                    style={
                      linkedContactId
                        ? styles.smallPillButtonText
                        : styles.smallPillButtonSecondaryText
                    }
                  >
                    {linkedContactId
                      ? contactLookup[linkedContactId] || 'Linked contact'
                      : contactsLoading
                      ? 'Loading contacts…'
                      : contacts.length
                      ? 'Choose a contact'
                      : 'No contacts yet'}
                  </Text>
                </TouchableOpacity>
                {linkedContactId ? (
                  <TouchableOpacity
                    style={styles.smallPillButtonGhost}
                    onPress={() => setLinkedContactId(null)}
                  >
                    <Text style={styles.smallPillButtonGhostText}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
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

          <Modal
            visible={contactPickerVisible}
            animationType="slide"
            transparent
            onRequestClose={() => setContactPickerVisible(false)}
          >
            <TouchableWithoutFeedback onPress={() => setContactPickerVisible(false)}>
              <View style={styles.pickerBackdrop}>
                <TouchableWithoutFeedback onPress={() => {}}>
                  <View style={styles.pickerSheet}>
                    <View style={styles.pickerHeader}>
                      <Text style={styles.pickerTitle}>Link reflection to a contact</Text>
                      <TouchableOpacity onPress={() => setContactPickerVisible(false)}>
                        <X size={20} color={Colors.text.secondary} />
                      </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.pickerList}>
                      {contacts.length === 0 ? (
                        <Text style={styles.pickerEmpty}>No contacts available yet.</Text>
                      ) : (
                        contacts.map((option) => (
                          <TouchableOpacity
                            key={option.id}
                            style={styles.pickerOption}
                            onPress={() => {
                              if (pickerMode === 'share' && pendingShareMessage) {
                                setContactPickerVisible(false);
                                router.push({
                                  pathname: '/ai-chat',
                                  params: {
                                    prefillDescription: pendingShareMessage,
                                    mode: 'new',
                                    contactId: option.id,
                                  },
                                });
                                setPendingShareMessage(null);
                                setPickerMode('link');
                              } else {
                                setLinkedContactId(option.id);
                                setContactPickerVisible(false);
                              }
                            }}
                          >
                            <Text style={styles.pickerOptionText}>{option.label}</Text>
                            {option.category ? (
                              <Text style={styles.pickerOptionMeta}>{option.category}</Text>
                            ) : null}
                          </TouchableOpacity>
                        ))
                      )}
                    </ScrollView>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>
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
  summaryCard: {
    marginTop: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary[100],
    backgroundColor: Colors.primary[50],
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  summaryTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[600],
    flex: 1,
  },
  summaryChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    backgroundColor: '#fff',
    fontSize: Typography.fontSize.xs,
    color: Colors.primary[600],
    fontWeight: Typography.fontWeight.medium,
    textTransform: 'capitalize',
  },
  summaryBody: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
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
  timelineCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.small,
    gap: Spacing.md,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.secondary,
  },
  timelineHint: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
  },
  coachCardWrapper: {
    marginTop: Spacing.md,
  },
  coachCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: Spacing.sm,
    ...Shadows.small,
  },
  coachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  coachHeadline: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  coachMessage: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  coachPromptList: {
    gap: 4,
  },
  coachPrompt: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.tertiary,
  },
  digestCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: Spacing.sm,
    ...Shadows.small,
  },
  digestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  digestSubhead: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  digestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  digestLabel: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
  },
  digestValue: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  shareButton: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[100],
  },
  shareButtonText: {
    color: Colors.primary[700],
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },
  voiceCard: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  modeToggle: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  modeToggleActive: {
    backgroundColor: Colors.primary[50],
    borderColor: Colors.primary[400],
  },
  modeToggleText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
  },
  modeToggleTextActive: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[700],
  },
  voiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[100],
  },
  voiceButtonDisabled: {
    opacity: 0.6,
  },
  voiceButtonText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.semibold,
  },
  keywordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  keywordChip: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  keywordChipText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
  },
  voiceCaptureCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  voiceHint: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
  },
  voiceControls: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary[500],
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
  },
  recordButtonActive: {
    backgroundColor: Colors.secondary[600],
  },
  recordButtonText: {
    color: '#ffffff',
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[100],
  },
  previewButtonText: {
    color: Colors.primary[700],
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  processingText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
  },
  contactQuickActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  smallPillButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  smallPillButtonActive: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary[500],
    backgroundColor: Colors.primary[50],
  },
  smallPillButtonSecondary: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  smallPillButtonText: {
    color: Colors.primary[600],
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
  },
  smallPillButtonSecondaryText: {
    color: Colors.text.tertiary,
    fontSize: Typography.fontSize.sm,
  },
  smallPillButtonGhost: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: 'transparent',
  },
  smallPillButtonGhostText: {
    color: Colors.text.secondary,
    fontSize: Typography.fontSize.sm,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  pickerSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    maxHeight: '70%',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  pickerTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  pickerList: {
    maxHeight: '100%',
  },
  pickerEmpty: {
    color: Colors.text.tertiary,
    fontSize: Typography.fontSize.sm,
  },
  pickerOption: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  pickerOptionText: {
    color: Colors.text.primary,
    fontSize: Typography.fontSize.base,
  },
  pickerOptionMeta: {
    color: Colors.text.tertiary,
    fontSize: Typography.fontSize.xs,
  },
});

export default SoulroomScreen;