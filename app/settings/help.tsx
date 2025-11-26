import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Mail, MessageCircle, Book, ExternalLink, ChevronRight } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';

interface FAQItem {
  question: string;
  answer: string;
}

const userGuideSections = [
  {
    title: 'Home / Landing Page',
    emoji: '🌸',
    intro: 'Each time you open Sorted, you land in a soft, welcoming space that remembers your name and mood.',
    bullets: [
      'See a gentle hello plus a quick reminder of how Sorted supports calm, caring conversations.',
      'Use the main buttons to jump into AI prep, revisit chats, or open the Soulroom.',
      'Navigation lives at the bottom—Chats, Contacts, Soulroom, and Settings are always one tap away.'
    ],
  },
  {
    title: 'AI Chat — Guided Flow',
    emoji: '💬',
    intro: 'The AI assistant helps you feel grounded before you reach out to someone. You’ll move through four caring stages:',
    bullets: [
      'Stage 1 · Set the Scene: Share what happened using “I / me / my” language. Sorted quietly tags names with @ or # so you stay in control.',
      'Stage 2 · Fill in the Gaps: Answer a few prompts to uncover feelings, needs, and intentions. You can edit anything.',
      'Stage 3 · Your Recap: The assistant creates a warm summary and “My Thoughts” section. Smileys appear when the discussion is ready for gentle closure.',
      'Stage 4 · Ready to Reach Out: Choose from kind, short message options—or craft your own—then move seamlessly into a real conversation.'
    ],
  },
  {
    title: 'Contacts',
    emoji: '🤝',
    intro: 'Build a thoughtful circle of people you care about.',
    bullets: [
      'Add contacts by email, search existing ones, or invite someone new.',
      'Apply relationship categories—family, friend, partner, team—to tailor the tone of AI suggestions.',
      'Use tags to remember moments (e.g., #wedding, #project) and keep conversations themed.'
    ],
  },
  {
    title: 'Soulroom · Reflection Space',
    emoji: '🪞',
    intro: 'Your quiet corner for journaling, mood check-ins, and voice reflections.',
    bullets: [
      'Write freely about feelings, log moods with emojis, or record a short voice note.',
      'AI insights surface gentle patterns each week, helping you notice growth.',
      'Everything here is private and can inspire the next AI chat or contact conversation.'
    ],
  },
  {
    title: 'Chats Tab',
    emoji: '📂',
    intro: 'Keep every conversation organized with clarity.',
    bullets: [
      'My Talks shows threads you initiated; Contacts’ Talks show conversations they began.',
      'Ongoing chats stay at the top with a soft badge; closed chats slide into History for revisiting later.',
      'Tap any chat to see both sides, summaries, and next-step suggestions.'
    ],
  },
  {
    title: 'AI Options & Responses',
    emoji: '✨',
    intro: 'Sorted suggests brief, heartfelt replies when words are hard to find.',
    bullets: [
      'Each option is crafted from your context, tags, and emotional tone.',
      'Review all options and pick the one that feels most “you”—or edit it before sending.',
      'Closure smileys appear when both sides feel ready to end on a gentle note.'
    ],
  },
  {
    title: 'Settings & Profile',
    emoji: '🧾',
    intro: 'Your profile shapes how Sorted speaks to and about you.',
    bullets: [
      'Update nickname, pronouns, or photo for a personal touch across the app.',
      'Adjust privacy preferences, notification timing, and data exports any time.',
      'Access Help & Support, legal links, and the full user guide right here.'
    ],
  },
  {
    title: 'Notifications',
    emoji: '🔔',
    intro: 'Gentle nudges keep you informed without overwhelming you.',
    bullets: [
      'Receive alerts for new AI summaries, contact replies, or closure confirmations.',
      'Set quiet hours or disable categories (e.g., reminders) under Settings → Notifications.',
      'In-app banners highlight urgent moments; everything else is calmly queued.'
    ],
  },
  {
    title: 'App Theme & Wellness Design',
    emoji: '🎨',
    intro: 'Everything you see is chosen to feel soothing and safe.',
    bullets: [
      'Pastel gradients, rounded edges, and generous spacing invite deep breaths.',
      'Readable fonts and high-contrast text make every message easy on the eyes.',
      'Animations are soft and purposeful, mirroring the tempo of a supportive friend.'
    ],
  },
  {
    title: 'History & Insights',
    emoji: '📘',
    intro: 'Growth becomes visible when you can revisit old stories with kindness.',
    bullets: [
      'Closed chats (with mutual smileys) are stored for peaceful reflection.',
      'Soulroom entries pair with conversation dates so you can see emotional arcs.',
      'Weekly insights celebrate progress and gently suggest next steps.'
    ],
  },
  {
    title: 'Safety & Privacy',
    emoji: '🛡️',
    intro: 'Your trust is at the center of Sorted.',
    bullets: [
      'Personal data, tags, and pronouns stay inside your account—never shared without consent.',
      'All chats, reflections, and AI sessions are encrypted. You control what to archive or delete.',
      'We continuously audit for data leaks so your emotional world remains yours.'
    ],
  },
];

export default function HelpSupportScreen() {
  const insets = useSafeAreaInsets();
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  const [showUserGuide, setShowUserGuide] = useState<boolean>(false);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.95)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const faqs: FAQItem[] = [
    {
      question: 'How do I add contacts to Sorted?',
      answer: 'Go to the Contacts tab and tap the "+" button. You can search for registered users by email or send email invitations to unregistered users. You can also categorize contacts as family, friend, partner, or work colleague to personalize your conversations.',
    },
    {
      question: 'How does the AI Assistant work?',
      answer: 'The AI Assistant guides you through 4 stages to prepare meaningful conversations: Stage 1 - Set the Scene (describe what happened), Stage 2 - Add Details (answer prompts about feelings and needs), Stage 3 - Your Recap (review AI-generated summary and thoughts), and Stage 4 - Ready to Reach Out (choose from AI-generated message options or write your own). You can save your progress at any stage and return later.',
    },
    {
      question: 'What is the Soulroom?',
      answer: 'The Soulroom is your private reflection space. You can write journal entries, track your mood with emojis, record voice notes, and receive weekly AI insights about your emotional patterns. Everything in the Soulroom is private and can inspire your conversations.',
    },
    {
      question: 'How do I start a conversation with a contact?',
      answer: 'Use the AI Assistant (tap the chat icon) to prepare your conversation through the 4-stage flow. Once ready, click "Send to contact" in Stage 4 to move to the chat screen. You can also open existing chats from the Chats tab - "My Talks" shows conversations you started, and "Contact Talks" shows conversations they started.',
    },
    {
      question: 'Are my conversations private?',
      answer: 'Yes, all conversations are private and encrypted. Only you and your contact can see your messages. AI Assistant sessions are completely private to you. You can delete conversations or clear all data anytime from Settings > Privacy & Security.',
    },
    {
      question: 'How do I manage notifications?',
      answer: 'Go to Settings > Notifications to customize when and how you receive notifications. You can enable/disable notifications for messages, contacts, AI responses, and Soulroom reminders. Set quiet hours or enable do not disturb mode to control when you receive alerts.',
    },
    {
      question: 'Can I delete my conversations?',
      answer: 'Yes, you can clear all your data (chats, messages, Soulroom entries) from Settings > Privacy & Security > Clear All Data. This keeps your account active. To permanently delete your account, use "Delete Account" which removes everything including your account. Both actions cannot be undone.',
    },
    {
      question: 'How do I change my profile information?',
      answer: 'Go to Settings > Profile to edit your name, nickname, phone number, date of birth, pronouns, and upload a profile picture. Your profile information helps personalize AI-generated options and conversations throughout the app.',
    },
  ];

  const toggleFAQ = (index: number) => {
    setExpandedFAQ(expandedFAQ === index ? null : index);
  };

  const openEmail = () => {
    Linking.openURL('mailto:sortedchatapp@gmail.com?subject=Sorted App Support');
  };

  const toggleUserGuide = () => {
    setShowUserGuide(prev => !prev);
  };

  const openPrivacyPolicy = () => {
    Linking.openURL('https://subbusudharsan.github.io/Cursor-Sorted-Project/legal/privacy.html');
  };

  const openTermsOfService = () => {
    Linking.openURL('https://subbusudharsan.github.io/Cursor-Sorted-Project/legal/terms.html');
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <Animated.View 
        style={[
          styles.content, 
          { 
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }
        ]}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top + Spacing.sm, Spacing.lg) }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={20} color={Colors.text.secondary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Help & Support</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Quick Actions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Get Help</Text>
            
            <TouchableOpacity style={styles.actionCard} onPress={openEmail}>
              <View style={styles.actionIcon}>
                <Mail size={16} color={Colors.secondary[500]} />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Contact Support</Text>
                <Text style={styles.actionDescription}>
                  Send us an email for personalized help
                </Text>
              </View>
              <ExternalLink size={16} color={Colors.text.tertiary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionCard} onPress={toggleUserGuide}>
              <View style={styles.actionIcon}>
                <Book size={16} color={Colors.secondary[500]} />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>In-app User Guide</Text>
                <Text style={styles.actionDescription}>
                  Step through the Sorted Chat flow, end-to-end
                </Text>
              </View>
              <ChevronRight
                size={16}
                color={Colors.text.tertiary}
                style={[styles.chevron, showUserGuide && styles.chevronExpanded]}
              />
            </TouchableOpacity>
          </View>

          {showUserGuide && (
            <View style={styles.userGuideSection}>
              <Text style={styles.sectionTitle}>Sorted App User Guide</Text>
              <Text style={styles.userGuideIntro}>
                Take a gentle tour of every space in Sorted. Breathe in, explore at your own pace, and let each section support the way you connect.
              </Text>
              {userGuideSections.map((section) => (
                <View key={section.title} style={styles.guideCard}>
                  <View style={styles.guideHeader}>
                    <Text style={styles.guideEmoji}>{section.emoji}</Text>
                    <Text style={styles.guideTitle}>{section.title}</Text>
                  </View>
                  <Text style={styles.guideIntro}>{section.intro}</Text>
                  <View style={styles.guideBulletList}>
                    {section.bullets.map((bullet, bulletIndex) => (
                      <View key={bulletIndex} style={styles.guideBullet}>
                        <View style={styles.guideBulletDot} />
                        <Text style={styles.guideBulletText}>{bullet}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              <Text style={styles.userGuideOutro}>
                Whenever you need a refresher, return here. Sorted will keep walking beside you—steady, kind, and on your side.
              </Text>
            </View>
          )}

          {/* FAQ Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
            
            {faqs.map((faq, index) => (
              <View key={index} style={styles.faqCard}>
                <TouchableOpacity
                  style={styles.faqHeader}
                  onPress={() => toggleFAQ(index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.faqQuestion}>{faq.question}</Text>
                  <ChevronRight 
                    size={16} 
                    color={Colors.text.tertiary}
                    style={[
                      styles.chevron,
                      expandedFAQ === index && styles.chevronExpanded
                    ]}
                  />
                </TouchableOpacity>
                
                {expandedFAQ === index && (
                  <View style={styles.faqAnswer}>
                    <Text style={styles.faqAnswerText}>{faq.answer}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* Legal Links */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Legal</Text>
            
            <TouchableOpacity style={styles.linkCard} onPress={openPrivacyPolicy}>
              <Text style={styles.linkText}>Privacy Policy</Text>
              <ExternalLink size={16} color={Colors.text.tertiary} />
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.linkCard} onPress={openTermsOfService}>
              <Text style={styles.linkText}>Terms of Service</Text>
              <ExternalLink size={16} color={Colors.text.tertiary} />
            </TouchableOpacity>
          </View>

          {/* App Information */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>App Information</Text>
            
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Version</Text>
                <Text style={styles.infoValue}>1.0.0</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Build</Text>
                <Text style={styles.infoValue}>2025.01.15</Text>
              </View>
              <View style={[styles.infoRow, styles.lastInfoRow]}>
                <Text style={styles.infoLabel}>Platform</Text>
                <Text style={styles.infoValue}>
                  {Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web'}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surfaceElevated,
    ...Shadows.small,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  headerTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
  },
  placeholder: {
    width: 36,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  section: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  actionDescription: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  faqCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  faqQuestion: {
    flex: 1,
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginRight: Spacing.sm,
  },
  chevron: {
    transform: [{ rotate: '0deg' }],
  },
  chevronExpanded: {
    transform: [{ rotate: '90deg' }],
  },
  faqAnswer: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  faqAnswerText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
    paddingTop: Spacing.sm,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  linkText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.secondary[500],
    fontWeight: Typography.fontWeight.medium,
  },
  infoCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  infoLabel: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  infoValue: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
  },
  lastInfoRow: {
    borderBottomWidth: 0,
  },
  userGuideSection: {
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: Spacing.md,
    ...Shadows.small,
  },
  userGuideIntro: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  guideCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  guideEmoji: {
    fontSize: Typography.fontSize.base,
  },
  guideTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  guideIntro: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  guideBulletList: {
    gap: Spacing.xs,
  },
  guideBullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  guideBulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.secondary[400],
    marginTop: 4,
  },
  guideBulletText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  userGuideOutro: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
    marginTop: Spacing.sm,
  },
});