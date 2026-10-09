import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
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
  bright?: boolean;
  compact?: boolean;
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
  bright = false,
  compact = false,
}: NotificationBannerProps) {
  const [slideAnim] = useState(new Animated.Value(-100));
  const [opacityAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.72));

  const hideNotification = () => {
    if (compact) {
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 0.86,
          duration: 650,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 650,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        onDismiss();
      });
      return;
    }
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

  useEffect(() => {
    if (visible) {
      if (compact) {
        scaleAnim.setValue(0.72);
        opacityAnim.setValue(0);
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 480,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 480,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
      } else {
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
      }

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

  const getIcon = () => {
    const iconProps = { size: compact ? 14 : 20, color: getIconColor() };
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
        return bright ? '#E65100' : Colors.primary[600];
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
        return bright ? '#FFC107' : Colors.primary[50];
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
        return bright ? '#FF8F00' : Colors.primary[200];
    }
  };

  if (!visible) return null;

  if (compact) {
    return (
      <View pointerEvents="none" style={styles.centerWrap}>
        <Animated.View
          style={[
            styles.goodbyeBox,
            {
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <Text style={styles.goodbyeText}>{title}</Text>
        </Animated.View>
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.container,
        compact && styles.containerCompact,
        {
          backgroundColor: compact ? Colors.background : getBackgroundColor(),
          borderColor: compact ? Colors.chat.userBubble : getBorderColor(),
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <View style={[styles.content, compact && styles.contentCompact]}>
        {!compact && (
          <View style={styles.iconContainer}>
            {getIcon()}
          </View>
        )}
        <View style={styles.textContainer}>
          <Text style={[styles.title, compact && styles.titleCompact, { color: compact ? Colors.chat.userBubble : bright ? '#1A1A1A' : getIconColor() }]}>{title}</Text>
          {message && <Text style={[styles.message, compact && styles.messageCompact, bright && { color: '#3E2723' }]}>{message}</Text>}
        </View>
        {!compact && (
          <TouchableOpacity style={styles.closeButton} onPress={hideNotification}>
            <X size={18} color={Colors.text.secondary} />
          </TouchableOpacity>
        )}
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
  containerCompact: {
    top: 118,
    left: Spacing.xl,
    right: Spacing.xl,
    borderRadius: 20,
    borderWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.lg,
  },
  contentCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
  },
  iconContainer: {
    marginRight: Spacing.md,
    marginTop: 2,
  },
  iconCompact: {
    marginRight: Spacing.xs,
    marginTop: 0,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    marginBottom: 2,
  },
  titleCompact: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
    marginBottom: 0,
    textAlign: 'center',
  },
  message: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  messageCompact: {
    fontSize: Typography.fontSize.xs,
    lineHeight: 16,
  },
  closeButton: {
    padding: 4,
    marginLeft: Spacing.sm,
  },
  centerWrap: {
    position: 'absolute',
    top: 132,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  goodbyeBox: {
    backgroundColor: '#1B7F4E',
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 28,
    maxWidth: width - 48,
  },
  goodbyeText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
});