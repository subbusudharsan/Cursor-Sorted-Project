import React, { Suspense, lazy, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Colors, Spacing, Typography } from '@/constants/Colors';

const LandingExperience = lazy(() => import('@/components/landing/LandingExperience'));

function LandingFallback({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.placeholderContainer}>
      <View style={styles.placeholderContent}>
        <LoadingSpinner size="large" />
        <Text style={styles.placeholderText}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

export default function LandingScreen() {
  const [shouldRenderContent, setShouldRenderContent] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setShouldRenderContent(true);
    }, 200); // allow the first frame to paint before loading heavy animations

    return () => clearTimeout(timeout);
  }, []);

  if (!shouldRenderContent) {
    return <LandingFallback message="Preparing your space…" />;
  }

  return (
    <Suspense fallback={<LandingFallback message="Loading experience…" />}>
      <LandingExperience />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  placeholderContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  placeholderContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  placeholderText: {
    marginTop: Spacing.md,
    color: Colors.text.secondary,
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.medium,
    textAlign: 'center',
  },
});