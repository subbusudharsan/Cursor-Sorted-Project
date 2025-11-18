import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { InteractionManager } from 'react-native';

const isWebPlatform = Platform.OS === 'web';
const webShadows = {
  small: { boxShadow: '0px 2px 6px rgba(13, 27, 42, 0.08)' },
  medium: { boxShadow: '0px 8px 20px rgba(13, 27, 42, 0.12)' },
  large: { boxShadow: '0px 14px 32px rgba(13, 27, 42, 0.16)' },
};

export default function LandingExperience() {
  const insets = useSafeAreaInsets();
  const { loading } = useAuth();
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(50)).current;
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  const textFadeAnim = React.useRef(new Animated.Value(0)).current;
  const textScaleAnim = React.useRef(new Animated.Value(0.8)).current;
  const textGlowAnim = React.useRef(new Animated.Value(1)).current;
  const textColorAnim = React.useRef(new Animated.Value(0)).current;
  const singleRotationAnim = React.useRef(new Animated.Value(0)).current;
  const logoScaleAnim = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';
  const combinedScaleAnim = Animated.multiply(pulseAnim, logoScaleAnim);
  
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
  
  const [textIsStationary, setTextIsStationary] = useState(false);
  const textIsStationaryRef = React.useRef(false);

  useEffect(() => {
    const startAnimations = () => {
      // Fade + slide-in animations
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: nativeDriver,
        }),
      ]).start();

      // Beautiful single rotation animation - all elements come together
      Animated.parallel([
        Animated.timing(textFadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: nativeDriver,
        }),
        Animated.spring(textScaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 8,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(hexagonOuterRotateAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(hexagonMiddleRotateAnim, {
          toValue: 1,
          duration: 3200,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(hexagonInnerRotateAnim, {
          toValue: 1,
          duration: 2800,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(ring1RotateAnim, {
          toValue: 1,
          duration: 3400,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(ring2RotateAnim, {
          toValue: 1,
          duration: 2600,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(floatingDot1RotateAnim, {
          toValue: 1,
          duration: 3600,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(floatingDot2RotateAnim, {
          toValue: 1,
          duration: 2400,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(floatingDot3RotateAnim, {
          toValue: 1,
          duration: 3800,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(floatingDot4RotateAnim, {
          toValue: 1,
          duration: 2200,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(accentDotsRotateAnim, {
          toValue: 1,
          duration: 3300,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(singleRotationAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: nativeDriver,
        }),
      ]).start(() => {
        setTextIsStationary(true);
        textIsStationaryRef.current = true;
        console.log('✨ Beautiful rotation animation completed - all shapes unified!');
      });

      // Text color + glow + pulse animations
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

      const pulse = () => {
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.02,
            duration: 2000,
            useNativeDriver: nativeDriver,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: nativeDriver,
          }),
        ]).start(() => pulse());
      };
      pulse();

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
          if (!textIsStationaryRef.current) glowPulse();
        });
      };
      glowPulse();

      const logoScaleAnimation = () => {
        Animated.sequence([
          Animated.timing(logoScaleAnim, {
            toValue: 1.05,
            duration: 1500,
            useNativeDriver: nativeDriver,
          }),
          Animated.timing(logoScaleAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: nativeDriver,
          }),
        ]).start(() => {
          if (!textIsStationaryRef.current) logoScaleAnimation();
        });
      };
      logoScaleAnimation();
    };

    if (isWebPlatform) {
      startAnimations();
      return () => undefined;
    }

    const task = InteractionManager.runAfterInteractions(startAnimations);
    return () => task?.cancel?.();
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
    <SafeAreaView style={[styles.container, { justifyContent: 'center' }]}>
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
                  transform: [
                    { scale: combinedScaleAnim },
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
                        { color: textOutlineColor },
                        !isWebPlatform && {
                          textShadowRadius: textGlowAnim.interpolate({
                            inputRange: [1, 1.5],
                            outputRange: [8, 12], // adjust if you want more/less glow
                          }),
                        },
                      ]}
                    >
                      SORTED
                    </Animated.Text>
                    <Animated.Text 
                      style={[
                        styles.logoTextGlow,
                        { color: textGlowColor },
                        !isWebPlatform && {
                          textShadowRadius: textGlowAnim.interpolate({
                            inputRange: [1, 1.5],
                            outputRange: [12, 18],
                          }),
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.md,
    justifyContent: 'center',
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
    marginBottom: Spacing.sm,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  logoCard: {
    width: 180,
    height: 180,
    position: 'relative',
  },
  hexagonContainer: {
    width: 170,
    height: 170,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexagonOuter: {
    position: 'absolute',
    width: 170,
    height: 170,
    backgroundColor: Colors.primary[100],
    transform: [{ rotate: '30deg' }],
    borderRadius: 20,
    ...(isWebPlatform ? webShadows.large : Shadows.large),
    ...(isWebPlatform
      ? {}
      : {
          shadowColor: Colors.primary[500],
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.3,
          shadowRadius: 20,
          elevation: 15,
        }),
  },
  hexagonMiddle: {
    position: 'absolute',
    width: 150,
    height: 150,
    backgroundColor: Colors.secondary[50],
    transform: [{ rotate: '0deg' }],
    borderRadius: 18,
    ...(isWebPlatform ? webShadows.medium : Shadows.medium),
    ...(isWebPlatform
      ? {}
      : {
          shadowColor: Colors.secondary[400],
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 10,
        }),
  },
  hexagonInner: {
    position: 'absolute',
    width: 130,
    height: 130,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    transform: [{ rotate: '15deg' }],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 235, 59, 0.4)',
    ...(isWebPlatform ? webShadows.small : Shadows.small),
  },
  gradientBackground: {
    position: 'absolute',
    width: 110,
    height: 110,
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
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingDot1: {
    position: 'absolute',
    top: 20,
    right: 30,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary[500],
    ...(isWebPlatform ? webShadows.small : Shadows.small),
  },
  floatingDot2: {
    position: 'absolute',
    bottom: 25,
    left: 25,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.secondary[400],
    ...(isWebPlatform ? webShadows.small : Shadows.small),
  },
  floatingDot3: {
    position: 'absolute',
    top: 35,
    left: 35,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success[400],
  },
  floatingDot4: {
    position: 'absolute',
    bottom: 35,
    right: 35,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: Colors.warning[400],
    ...(isWebPlatform ? webShadows.small : Shadows.small),
  },
  accentRings: {
    position: 'absolute',
    width: 190,
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring1: {
    position: 'absolute',
    width: 185,
    height: 185,
    borderRadius: 92.5,
    borderWidth: 1,
    borderColor: 'rgba(255, 235, 59, 0.3)',
  },
  ring2: {
    position: 'absolute',
    width: 195,
    height: 195,
    borderRadius: 97.5,
    borderWidth: 1,
    borderColor: 'rgba(0, 136, 209, 0.2)',
  },
  centerGlow: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255, 235, 59, 0.1)',
    ...(isWebPlatform ? webShadows.medium : Shadows.medium),
  },
  accentDots: {
    flexDirection: 'row',
    position: 'absolute',
    top: -12,
    right: -12,
    gap: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    ...(isWebPlatform ? webShadows.small : Shadows.small),
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
    bottom: 30,
    left: '50%',
    marginLeft: -50, // Half of width to center
    width: 100,
    height: 2,
    backgroundColor: Colors.secondary[400],
    borderRadius: 1,
    opacity: 0.8,
    ...(isWebPlatform ? webShadows.small : Shadows.small),
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
    fontSize: 26, // Larger size for better visibility
    fontWeight: Typography.fontWeight.bold,
    fontFamily: Platform.OS === 'ios' ? 'Avenir-Heavy' : 'sans-serif-condensed',
    // Color now animated via textOutlineColor
    transform: [{ scale: 1.0 }],
    ...(isWebPlatform
      ? { textShadow: '2px 2px 6px rgba(13, 71, 161, 0.4)' }
      : {
          textShadowColor: '#0D47A1', // Dark blue shadow
          textShadowOffset: { width: 2, height: 2 },
          textShadowRadius: 8,
        }),
    textAlign: 'center',
  },
  logoTextGlow: {
    position: 'absolute',
    fontSize: 26, // Larger size for better visibility
    fontWeight: Typography.fontWeight.bold,
    fontFamily: Platform.OS === 'ios' ? 'Avenir-Heavy' : 'sans-serif-condensed',
    // Color now animated via textGlowColor
    transform: [{ scale: 1.0 }],
    ...(isWebPlatform
      ? { textShadow: '0px 0px 12px rgba(245, 127, 23, 0.65)' }
      : {
          textShadowColor: '#F57F17', // Yellow shadow for glow
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 12,
        }),
    textAlign: 'center',
  },
  logoTextMain: {
    fontSize: 28, // Larger main text
    fontWeight: Typography.fontWeight.bold,
    fontFamily: Platform.OS === 'ios' ? 'Avenir-Heavy' : 'sans-serif-condensed',
    color: '#FFFFFF', // White main text for contrast
    ...(isWebPlatform
      ? { textShadow: '1px 1px 4px rgba(21, 101, 192, 0.45)' }
      : {
          textShadowColor: '#1565C0', // Blue shadow
          textShadowOffset: { width: 1, height: 1 },
          textShadowRadius: 6,
        }),
  },
  tagline: {
    fontSize: Typography.fontSize.sm,
    color: '#7B2CBF',
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    marginTop: Spacing.md,
    marginBottom: 0,
    fontWeight: Typography.fontWeight.bold,
    letterSpacing: 0.5,
    fontStyle: 'italic',
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  heroTitle: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
    lineHeight: Typography.lineHeight.tight * Typography.fontSize.xl,
    letterSpacing: 0.5,
  },
  heroSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
    letterSpacing: 0.2,
  },
  featuresContainer: {
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  featureCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    ...(isWebPlatform ? webShadows.medium : Shadows.medium),
    borderWidth: 2,
    borderColor: Colors.primary[200],
    ...(isWebPlatform
      ? {}
      : {
          shadowColor: Colors.primary[400],
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.2,
          shadowRadius: 16,
          elevation: 8,
        }),
  },
  featureIconContainer: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
    ...(isWebPlatform ? webShadows.small : Shadows.small),
    borderWidth: 3,
    borderColor: Colors.primary[400],
    ...(isWebPlatform
      ? {}
      : {
          shadowColor: Colors.primary[500],
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.3,
          shadowRadius: 6,
          elevation: 4,
        }),
  },
  featureEmoji: {
    fontSize: 20,
  },
  featureContent: {
    flex: 1,
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
    letterSpacing: 0.2,
  },
  featureDescription: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.medium,
    letterSpacing: 0.1,
  },
  ctaContainer: {
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
  },
  primaryButton: {
    width: '100%',
    marginBottom: Spacing.md,
    backgroundColor: Colors.primary[500],
    borderWidth: 3,
    borderColor: Colors.secondary[500],
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: Typography.fontWeight.bold,
    fontSize: Typography.fontSize.lg,
    letterSpacing: 0.3,
  },
  signInContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
  },
  signInText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
    letterSpacing: 0.2,
  },
  signInLink: {
    fontSize: Typography.fontSize.base,
    color: Colors.secondary[600],
    fontWeight: Typography.fontWeight.bold,
    marginLeft: Spacing.xs,
    letterSpacing: 0.2,
  },
});