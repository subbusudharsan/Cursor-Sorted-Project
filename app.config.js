// app.config.js - This file reads environment variables from .env file
require('dotenv').config();

module.exports = {
  expo: {
    name: "Sorted",
    slug: "sorted-app",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "sorted",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/images/icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    platforms: ["ios", "android", "web"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.sorted.app",
      infoPlist: {
        NSCameraUsageDescription: "Allow Sorted to access your camera to take photos for your profile.",
        NSPhotoLibraryUsageDescription: "Allow Sorted to access your photos to set your profile picture."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon-foreground.png",
        backgroundImage: "./assets/images/icon-background.png"
      },
    
      package: "com.sorted.app",
      versionCode: 3,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE"
      ]
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/favicon.png",
      build: {
        babel: {
          include: []
        }
      },
      serviceWorker: {
        register: false
      },
      ssr: false
    },
    jsEngine: "hermes",
    plugins: [
      "expo-router",
      "expo-font",
      "expo-web-browser",
      "expo-secure-store",
      [
        "expo-camera",
        {
          cameraPermission: "Allow Sorted to access your camera to take photos for your profile."
        }
      ],
      [
        "expo-image-picker",
        {
          photosPermission: "Allow Sorted to access your photos to set your profile picture."
        }
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/icon.png",
          color: "#4f46e5",
          sounds: []
        }
      ]
    ],
    runtimeVersion: {
      policy: "sdkVersion"
    },
    experiments: {
      typedRoutes: true
    },
    updates: {
      fallbackToCacheTimeout: 0
    },
    extra: {
      router: {
        origin: false
      },
      // ✅ Supabase environment variables
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "",
      // ✅ EAS configuration
      eas: {
        projectId: process.env.EAS_PROJECT_ID || ""
      }
    }
  }
};





