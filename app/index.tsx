// app/index.tsx
import React from "react";
import LandingExperience from "@/components/landing/LandingExperience";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";
import { Colors } from "@/constants/Colors";

export default function LandingScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <LandingExperience />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
