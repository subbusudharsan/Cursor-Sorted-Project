import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { Heart, MessageCircle, Users, Shield, Headphones, Smile } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';


export default function LandingScreen() {
  const insets = useSafeAreaInsets();
  const { session, loading } = useAuth();
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(50)).current;
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  const textFadeAnim = React.useRef(new Animated.Value(0)).current;
  const textScaleAnim = React.useRef(new Animated.Value(0.8)).current;
  const textGlowAnim = React.useRef(new Animated.Value(1)).current;
  const textColorAnim = React.useRef(new Animated.Value(0)).current;
  const initialTextRotationAnim = React.useRef(new Animated.Value(0)).current;
  const singleRotationAnim = React.useRef(new Animated.Value(0)).current;
  const logoScaleAnim = React.useRef(new Animated.Value(1)).current;
  
  // Individual rotation animations for each shape
  const hexagonOuterRotateAnim = React.useRef(new Animated.Value(0)).current;
  const hexagonMiddleRotateAnim = React.useRef(new Animated.Value(0)).current;
  const hexagonInnerRotateAnim = React.useRef(new Animated.Value(0)).current;
  const ring1RotateAnim = React.useRef(new Animated.Value(0)).current;
  const ring2RotateAnim = React.useRef(new Animated.Value(0)).current;
  const floatingDot1RotateAnim = React.useRef(new Animated.Value(0)).current;
  const floatingDot2RotateAnim = React.useRef(new Animated.Value(0)).current;
  const floatingDot3RotateAnim = React.useRef(new Animated.Value(0)).current;
  const floatingDot4RotateAnim = React.useRef(new Animated.Value(0)).current;
  const accentDotsRotateAnim = React.useRef(new Animated.Value(0)).current;
  
  const [applyCounterRotation, setApplyCounterRotation] = useState(false);
  const [textIsStationary, setTextIsStationary] = useState(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();

    // Beautiful single rotation animation - all elements come together
    Animated.parallel([
      Animated.timing(textFadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(textScaleAnim, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
      
      // Individual shape rotations - each with different speeds and directions
      Animated.timing(hexagonOuterRotateAnim, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: true,
      }),
      Animated.timing(hexagonMiddleRotateAnim, {
        toValue: 1,
        duration: 3200, // Slightly different speed
        useNativeDriver: true,
      }),
      Animated.timing(hexagonInnerRotateAnim, {
        toValue: 1,
        duration: 2800, // Different speed
        useNativeDriver: true,
      }),
      Animated.timing(ring1RotateAnim, {
        toValue: 1,
        duration: 3400, // Different speed
        useNativeDriver: true,
      }),
      Animated.timing(ring2RotateAnim, {
        toValue: 1,
        duration: 2600, // Different speed
        useNativeDriver: true,
      }),
      Animated.timing(floatingDot1RotateAnim, {
        toValue: 1,
        duration: 3600, // Different speed
        useNativeDriver: true,
      }),
      Animated.timing(floatingDot2RotateAnim, {
        toValue: 1,
        duration: 2400, // Different speed
        useNativeDriver: true,
      }),
      Animated.timing(floatingDot3RotateAnim, {
        toValue: 1,
        duration: 3800, // Different speed
        useNativeDriver: true,
      }),
      Animated.timing(floatingDot4RotateAnim, {
        toValue: 1,
        duration: 2200, // Different speed
        useNativeDriver: true,
      }),
      Animated.timing(accentDotsRotateAnim, {
        toValue: 1,
        duration: 3300, // Different speed
        useNativeDriver: true,
      }),
      Animated.timing(singleRotationAnim, {
        toValue: 1,
        duration: 3000, // Text rotation
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Animation complete - all shapes have come together beautifully
      setTextIsStationary(true);
      console.log('✨ Beautiful rotation animation completed - all shapes unified!');
    });

    // Initial color animation for text (one cycle)
    Animated.timing(textColorAnim, {
      toValue: 1,
      duration: 5000,
      useNativeDriver: false,
    }).start(() => {
      Animated.timing(textColorAnim, {
        toValue: 0,
        duration: 5000,
        useNativeDriver: false,
      }).start();
    });

    // Subtle pulse animation for the logo
    const pulse = () => {
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.02,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]).start(() => pulse());
    };
    pulse();

    // Gentle glow animation during rotation (stops when stationary)
    const glowPulse = () => {
      Animated.sequence([
        Animated.timing(textGlowAnim, {
          toValue: 1.5,
          duration: 1500,
          useNativeDriver: false,
        }),
        Animated.timing(textGlowAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: false,
        }),
      ]).start(() => {
        // Stop glow when animation is complete
        if (!textIsStationary) {
          glowPulse();
        }
      });
    };
    glowPulse();

    // Gentle logo scale animation during rotation
    const logoScaleAnimation = () => {
      Animated.sequence([
        Animated.timing(logoScaleAnim, {
          toValue: 1.05,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(logoScaleAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Stop scaling when animation is complete
        if (!textIsStationary) {
          logoScaleAnimation();
        }
      });
    };
    logoScaleAnimation();
  }, []);

  const singleRotate = singleRotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  
  // Individual rotation interpolations for each shape
  const hexagonOuterRotate = hexagonOuterRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'], // Clockwise
  });
  
  const hexagonMiddleRotate = hexagonMiddleRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-360deg'], // Counter-clockwise
  });
  
  const hexagonInnerRotate = hexagonInnerRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '720deg'], // Double rotation clockwise
  });
  
  const ring1Rotate = ring1RotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-540deg'], // 1.5 rotations counter-clockwise
  });
  
  const ring2Rotate = ring2RotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '540deg'], // 1.5 rotations clockwise
  });
  
  const floatingDot1Rotate = floatingDot1RotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '450deg'], // 1.25 rotations
  });
  
  const floatingDot2Rotate = floatingDot2RotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-450deg'], // 1.25 rotations counter-clockwise
  });
  
  const floatingDot3Rotate = floatingDot3RotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '270deg'], // 0.75 rotation
  });
  
  const floatingDot4Rotate = floatingDot4RotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-270deg'], // 0.75 rotation counter-clockwise
  });
  
  const accentDotsRotate = accentDotsRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'], // Half rotation
  });

  const textOutlineColor = textColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#1565C0', '#F9A825'], // Blue to Yellow
  });

  const textGlowColor = textColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#1976D2', '#FDD835'], // Bright Blue to Bright Yellow
  });


  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingSpinner size="large" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
    <ScrollView style={styles.container} contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(Spacing.lg, insets.bottom) }]}> 
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Animated.View 
              style={[
                styles.logoCard,
                {
                  transform: [{ scale: pulseAnim }],
                },
                {
                  transform: [
                    { scale: logoScaleAnim },
                    { rotate: singleRotate },
                  ],
                },
              ]}
            >
              <View style={styles.accentRings}>
                <Animated.View 
                  style={[
                    styles.ring1,
                    {
                      transform: [{ rotate: ring1Rotate }],
                    },
                  ]}
                />
                <Animated.View 
                  style={[
                    styles.ring2,
                    {
                      transform: [{ rotate: ring2Rotate }],
                    },
                  ]}
                />
              </View>
              
              <View style={styles.floatingElements}>
                <Animated.View 
                  style={[
                    styles.floatingDot1,
                    {
                      transform: [{ rotate: floatingDot1Rotate }],
                    },
                  ]}
                />
                <Animated.View 
                  style={[
                    styles.floatingDot2,
                    {
                      transform: [{ rotate: floatingDot2Rotate }],
                    },
                  ]}
                />
                <Animated.View 
                  style={[
                    styles.floatingDot3,
                    {
                      transform: [{ rotate: floatingDot3Rotate }],
                    },
                  ]}
                />
                <Animated.View 
                  style={[
                    styles.floatingDot4,
                    {
                      transform: [{ rotate: floatingDot4Rotate }],
                    },
                  ]}
                />
              </View>
              
              <View style={styles.hexagonContainer}>
                <Animated.View 
                  style={[
                    styles.hexagonOuter,
                    {
                      transform: [{ rotate: hexagonOuterRotate }],
                    },
                  ]}
                />
                <Animated.View 
                  style={[
                    styles.hexagonMiddle,
                    {
                      transform: [{ rotate: hexagonMiddleRotate }],
                    },
                  ]}
                />
                <Animated.View 
                  style={[
                    styles.hexagonInner,
                    {
                      transform: [{ rotate: hexagonInnerRotate }],
                    },
                  ]}
                />
                <View style={styles.centerGlow} />
                
                <View style={styles.gradientBackground}>
                <View style={styles.logoContent}>
                  <Animated.View 
                    style={[
                      styles.accentDots,
                      {
                        transform: [{ rotate: accentDotsRotate }],
                      },
                    ]}
                  >
                    <View style={[styles.dot, styles.dot1]} />
                    <View style={[styles.dot, styles.dot2]} />
                    <View style={[styles.dot, styles.dot3]} />
                  </Animated.View>
                  
                  <Animated.View 
                    style={[
                      styles.sparklyTextContainer,
                      {
                        opacity: textFadeAnim,
                        transform: [
                          { scale: textScaleAnim },
                          { rotate: singleRotate },
                          ...(textIsStationary ? [] : []),
                        ],
                      },
                    ]}
                  >
                    <Animated.Text 
                      style={[
                        styles.logoTextOutline,
                        {
                          color: textOutlineColor,
                          textShadowRadius: textGlowAnim.interpolate({
  inputRange: [1, 1.5],
  outputRange: [8, 12], // adjust if you want more/less glow
})
                        },
                      ]}
                    >
                      SORTED
                    </Animated.Text>
                    <Animated.Text 
                      style={[
                        styles.logoTextGlow,
                        {
                          color: textGlowColor,
                          textShadowRadius: textGlowAnim.interpolate({
  inputRange: [1, 1.5],
  outputRange: [12, 18], 
})

                        },
                      ]}
                    >
                      SORTED
                    </Animated.Text>
                  </Animated.View>
                  
                  <Animated.View 
                    style={[
                      styles.underline,
                      {
                        transform: textIsStationary ? [] : [{ rotate: singleRotate }],
                      },
                    ]}
                  />
                </View>
                </View>
              </View>
            </Animated.View>
          </View>
          <Text style={styles.tagline}>
            Connect 💖 Share 📱 Smile 😊
          </Text>
        </View>

        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>Tune Into Your Feelings 🎧</Text>
          <Text style={styles.heroSubtitle}>
            
          </Text>
        </View>

        <View style={styles.featuresContainer}>
          <View style={styles.featureCard}>
            <View style={styles.featureIconContainer}>
              <Text style={styles.featureEmoji}>💬</Text>
            </View>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Speak Your Thoughts</Text>
              <Text style={styles.featureDescription}>
                Feeling off? Let it out — say what's bugging you. I'm here, no judgment.
              </Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <View style={styles.featureIconContainer}>
              <Text style={styles.featureEmoji}>⏰</Text>
            </View>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Take It Slow</Text>
              <Text style={styles.featureDescription}>
                Breathe. You're doing just fine.
              </Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <View style={styles.featureIconContainer}>
              <Text style={styles.featureEmoji}>⚡</Text>
            </View>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Slide Through Anytime</Text>
              <Text style={styles.featureDescription}>
                Ready to talk? Just drop a message, I'm always just a ping away.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.ctaContainer}>
          <Button
            title="Get Started"
            variant="primary"
            size="large"
            onPress={() => router.push('/(auth)/signup')}
            style={styles.primaryButton}
            textStyle={styles.primaryButtonText}
          />
          
          <View style={styles.signInContainer}>
            <Text style={styles.signInText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/signin')}>
              <Text style={styles.signInLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: 40,
    paddingBottom: Spacing.lg,
    justifyContent: 'space-between',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: Spacing.lg,
  },
  loadingText: {
    fontSize: Typography.fontSize.lg,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  logoCard: {
    width: 200,
    height: 200,
    position: 'relative',
  },
  hexagonContainer: {
    width: 180,
    height: 180,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexagonOuter: {
    position: 'absolute',
    width: 180,
    height: 180,
    backgroundColor: Colors.primary[100],
    transform: [{ rotate: '30deg' }],
    borderRadius: 20,
    ...Shadows.large,
    shadowColor: Colors.primary[500],
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 15,
  },
  hexagonMiddle: {
    position: 'absolute',
    width: 160,
    height: 160,
    backgroundColor: Colors.secondary[50],
    transform: [{ rotate: '0deg' }],
    borderRadius: 18,
    ...Shadows.medium,
    shadowColor: Colors.secondary[400],
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  hexagonInner: {
    position: 'absolute',
    width: 140,
    height: 140,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    transform: [{ rotate: '15deg' }],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 235, 59, 0.4)',
    ...Shadows.small,
  },
  gradientBackground: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(0, 136, 209, 0.2)',
  },
  logoContent: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  floatingElements: {
    position: 'absolute',
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingDot1: {
    position: 'absolute',
    top: 20,
    right: 30,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary[500],
    ...Shadows.small,
  },
  floatingDot2: {
    position: 'absolute',
    bottom: 25,
    left: 25,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.secondary[400],
    ...Shadows.small,
  },
  floatingDot3: {
    position: 'absolute',
    top: 40,
    left: 40,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success[400],
  },
  floatingDot4: {
    position: 'absolute',
    bottom: 40,
    right: 40,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.warning[400],
    ...Shadows.small,
  },
  accentRings: {
    position: 'absolute',
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring1: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1,
    borderColor: 'rgba(255, 235, 59, 0.3)',
  },
  ring2: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 1,
    borderColor: 'rgba(0, 136, 209, 0.2)',
  },
  centerGlow: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 235, 59, 0.1)',
    ...Shadows.medium,
  },
  accentDots: {
    flexDirection: 'row',
    position: 'absolute',
    top: -15,
    right: -15,
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    ...Shadows.small,
  },
  dot1: {
    backgroundColor: Colors.primary[500],
  },
  dot2: {
    backgroundColor: Colors.secondary[400],
  },
  dot3: {
    backgroundColor: Colors.success[400],
  },
  underline: {
    position: 'absolute',
    bottom: 35,
    left: '50%',
    marginLeft: -55, // Half of width (70/2) to center
    width: 112,
    height: 2,
    backgroundColor: Colors.secondary[400],
    borderRadius: 1,
    opacity: 0.8,
    ...Shadows.small,
  },
  sparklyTextContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoTextOutline: {
    position: 'absolute',
    fontSize: 28, // Smaller size to fit perfectly in inner square
    fontWeight: Typography.fontWeight.bold,
    fontFamily: Platform.OS === 'ios' ? 'Avenir-Heavy' : 'sans-serif-condensed',
    // Color now animated via textOutlineColor
    transform: [{ scale: 1.0 }],
    textShadowColor: '#0D47A1', // Dark blue shadow
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 8,
    textAlign: 'center',
  },
  logoTextGlow: {
    position: 'absolute',
    fontSize: 28, // Smaller size to fit perfectly in inner square
    fontWeight: Typography.fontWeight.bold,
    fontFamily: Platform.OS === 'ios' ? 'Avenir-Heavy' : 'sans-serif-condensed',
    // Color now animated via textGlowColor
    transform: [{ scale: 1.0 }],
    textShadowColor: '#F57F17', // Yellow shadow for glow
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
    textAlign: 'center',
  },
  logoTextMain: {
    fontSize: 28, // Larger main text
    fontWeight: Typography.fontWeight.bold,
    fontFamily: Platform.OS === 'ios' ? 'Avenir-Heavy' : 'sans-serif-condensed',
    color: '#FFFFFF', // White main text for contrast
    textShadowColor: '#1565C0', // Blue shadow
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 6,
  },
  tagline: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.base,
    marginTop: Spacing.sm,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  heroTitle: {
    fontSize: Typography.fontSize['2xl'],
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    lineHeight: Typography.lineHeight.tight * Typography.fontSize['2xl'],
  },
  heroSubtitle: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.base,
  },
  featuresContainer: {
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  featureCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    ...Shadows.medium,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: Colors.primary[200],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  featureIconContainer: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
    ...Shadows.small,
    borderWidth: 2,
    borderColor: Colors.primary[200],
  },
  featureEmoji: {
    fontSize: 20,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  featureDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  ctaContainer: {
    alignItems: 'center',
  },
  primaryButton: {
    width: '100%',
    marginBottom: Spacing.md,
    backgroundColor: Colors.primary[500], // Keep yellow background
    borderWidth: 3,
    borderColor: Colors.secondary[600], // Blue border
  },
  primaryButtonText: {
    color: '#FFFFFF', // Pure white text
    fontWeight: Typography.fontWeight.bold,
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  signInContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signInText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
  },
  signInLink: {
    fontSize: Typography.fontSize.base,
    color: Colors.secondary[600], // Blue to match app background theme
    fontWeight: Typography.fontWeight.semibold,
  },
});