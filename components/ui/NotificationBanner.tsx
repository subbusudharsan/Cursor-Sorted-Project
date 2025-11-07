import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { CircleCheck as CheckCircle, CircleAlert as AlertCircle, Info, X, TriangleAlert as AlertTriangle } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';

interface NotificationBannerProps {
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  visible: boolean;
  onDismiss: () => void;
  autoHide?: boolean;
  duration?: number;
}

const { width } = Dimensions.get('window');

export default function NotificationBanner({
  type,
  title,
  message,
  visible,
  onDismiss,
  autoHide = true,
  duration = 4000,
}: NotificationBannerProps) {
  const [slideAnim] = useState(new Animated.Value(-100));
  const [opacityAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      // Slide in animation
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto hide
      if (autoHide) {
        const timer = setTimeout(() => {
          hideNotification();
        }, duration);
        return () => clearTimeout(timer);
      }
    } else {
      hideNotification();
    }
  }, [visible]);

  const hideNotification = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  const getIcon = () => {
    const iconProps = { size: 20, color: getIconColor() };
    switch (type) {
      case 'success':
        return <CheckCircle {...iconProps} />;
      case 'error':
        return <AlertCircle {...iconProps} />;
      case 'warning':
        return <AlertTriangle {...iconProps} />;
      case 'info':
      default:
        return <Info {...iconProps} />;
    }
  };

  const getIconColor = () => {
    switch (type) {
      case 'success':
        return Colors.success[600];
      case 'error':
        return Colors.error[600];
      case 'warning':
        return Colors.warning[600];
      case 'info':
      default:
        return Colors.primary[600];
    }
  };

  const getBackgroundColor = () => {
    switch (type) {
      case 'success':
        return Colors.success[50];
      case 'error':
        return Colors.error[50];
      case 'warning':
        return Colors.warning[50];
      case 'info':
      default:
        return Colors.primary[50];
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'success':
        return Colors.success[200];
      case 'error':
        return Colors.error[200];
      case 'warning':
        return Colors.warning[200];
      case 'info':
      default:
        return Colors.primary[200];
    }
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          {getIcon()}
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: getIconColor() }]}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}
        </View>
        <TouchableOpacity style={styles.closeButton} onPress={hideNotification}>
          <X size={18} color={Colors.text.secondary} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: Spacing.lg,
    right: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    zIndex: 9999,
    ...Shadows.medium,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.lg,
  },
  iconContainer: {
    marginRight: Spacing.md,
    marginTop: 2,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    marginBottom: 2,
  },
  message: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  closeButton: {
    padding: 4,
    marginLeft: Spacing.sm,
  },
});