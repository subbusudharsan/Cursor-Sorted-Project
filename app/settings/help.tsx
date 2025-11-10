import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Mail, MessageCircle, Book, ExternalLink, ChevronRight } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';

interface FAQItem {
  question: string;
  answer: string;
}

const userGuideSteps = [
  {
    title: 'Start on the Chats Home tab',
    description: 'Glance at your latest talks, unread nudges, and the welcome banner tailored to your name.'
  },
  {
    title: 'Prep with the AI Assistant',
    description: 'Tap “Discuss with AI Assistant” to begin Stage 1. Share your story, answer a few reflective questions, and review the summary before inviting your contact.'
  },
  {
    title: 'Send options when you’re ready',
    description: 'Once you hit “Ready to Chat,” choose an option that feels right and send it to your contact to start the real conversation.'
  },
  {
    title: 'Continue in Contact Chat',
    description: 'Track the full exchange, view both perspectives, and respond using the curated options without ever losing context.'
  },
  {
    title: 'Reflect in the Soulroom',
    description: 'Capture how the chat made you feel, record voice notes, follow mood trends, and unlock gentle AI nudges each week.'
  },
  {
    title: 'Revisit Settings anytime',
    description: 'Update your profile, tweak notifications, or review policies—all live-updating throughout the app.'
  }
];

export default function HelpSupportScreen() {
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  const [showUserGuide, setShowUserGuide] = useState<boolean>(false);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  const faqs: FAQItem[] = [
    {
      question: 'How do I add contacts to Sorted?',
      answer: 'Go to the Contacts tab and tap the "+" button. You can search for registered users by email or send email invitations to unregistered users.',
    },
    {
      question: 'How does the AI Assistant work?',
      answer: 'The AI Assistant helps you process emotions and prepare for conversations. Share your thoughts, and it will provide insights and help you get ready to talk with your contacts.',
    },
    {
      question: 'What is the Soulroom?',
      answer: 'The Soulroom is your private space for personal reflection. Write about your emotions, track your mood, and maintain a wellness journal.',
    },
    {
      question: 'How do I start a conversation with a contact?',
      answer: 'From the Chats tab, tap on a contact or use the AI Assistant to prepare for a conversation. The AI can help generate conversation starters.',
    },
    {
      question: 'Are my conversations private?',
      answer: 'Yes, all conversations are private and encrypted. Only you and your contact can see your messages. The AI Assistant conversations are also private to you.',
    },
    {
      question: 'How do I manage notifications?',
      answer: 'Go to Settings > Notifications to customize when and how you receive notifications. You can set quiet hours, disable specific types, or enable do not disturb.',
    },
    {
      question: 'Can I delete my conversations?',
      answer: 'Yes, you can delete individual conversations or clear all your data from the Settings menu. This action cannot be undone.',
    },
    {
      question: 'How do I change my profile information?',
      answer: 'Go to Settings > Profile to edit your name, phone number, date of birth, and other personal information. You can also upload a profile picture.',
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
    Linking.openURL('https://doc-hosting.flycricket.io/sorted-privacy-policy/1568dbc0-d11d-48b1-b85e-7e5b1aaac64e/privacy');
  };

  const openTermsOfService = () => {
    Linking.openURL('https://doc-hosting.flycricket.io/sorted-terms-of-use/39b52541-4a24-470e-a611-b796984adb4d/terms');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={Colors.text.secondary} />
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
                <Mail size={24} color={Colors.primary[500]} />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Contact Support</Text>
                <Text style={styles.actionDescription}>
                  Send us an email for personalized help
                </Text>
              </View>
              <ExternalLink size={20} color={Colors.text.tertiary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionCard} onPress={toggleUserGuide}>
              <View style={styles.actionIcon}>
                <Book size={24} color={Colors.secondary[500]} />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>In-app User Guide</Text>
                <Text style={styles.actionDescription}>
                  Step through the Sorted Chat flow, end-to-end
                </Text>
              </View>
              <ChevronRight
                size={20}
                color={Colors.text.tertiary}
                style={[styles.chevron, showUserGuide && styles.chevronExpanded]}
              />
            </TouchableOpacity>
          </View>

          {showUserGuide && (
            <View style={styles.userGuideSection}>
              <Text style={styles.sectionTitle}>Sorted Chat User Guide</Text>
              <Text style={styles.userGuideIntro}>
                Follow these calm, friendly steps whenever you want Sorted to help you navigate a conversation.
              </Text>
              {userGuideSteps.map((step, index) => (
                <View key={step.title} style={styles.userGuideStep}>
                  <View style={styles.userGuideBullet}>
                    <Text style={styles.userGuideBulletText}>{index + 1}</Text>
                  </View>
                  <View style={styles.userGuideContent}>
                    <Text style={styles.userGuideStepTitle}>{step.title}</Text>
                    <Text style={styles.userGuideStepDescription}>{step.description}</Text>
                  </View>
                </View>
              ))}
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
                    size={20} 
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
              <View style={styles.infoRow}>
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
    color: Colors.text.primary,
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  section: {
    marginBottom: Spacing.xxxl,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.lg,
  },
  actionCard: {
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
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.lg,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  actionDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  faqCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
  },
  faqQuestion: {
    flex: 1,
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginRight: Spacing.md,
  },
  chevron: {
    transform: [{ rotate: '0deg' }],
  },
  chevronExpanded: {
    transform: [{ rotate: '90deg' }],
  },
  faqAnswer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  faqAnswerText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    paddingTop: Spacing.md,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  linkText: {
    fontSize: Typography.fontSize.base,
    color: Colors.primary[500],
    fontWeight: Typography.fontWeight.medium,
  },
  infoCard: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadows.small,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  infoLabel: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  infoValue: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
  },
  userGuideSection: {
    marginBottom: Spacing.lg,
    backgroundColor: '#f6f8ff',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: '#d9e3ff',
    gap: Spacing.md,
  },
  userGuideIntro: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  userGuideStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  userGuideBullet: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  userGuideBulletText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[600],
  },
  userGuideContent: {
    flex: 1,
  },
  userGuideStepTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: 4,
  },
  userGuideStepDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
});