import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
} from 'react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  style,
  textStyle,
  icon,
}: ButtonProps) {
  const getButtonStyle = (): ViewStyle => {
    const baseStyle: ViewStyle = {
      borderRadius: BorderRadius.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      ...getPaddingForSize(),
    };

    switch (variant) {
      case 'primary':
        return {
          ...baseStyle,
          backgroundColor: disabled ? Colors.neutral[300] : Colors.primary[500],
          borderWidth: 3,
          borderColor: disabled ? Colors.neutral[300] : Colors.secondary[600],
          ...(!disabled && Shadows.small),
        };
      case 'secondary':
        return {
          ...baseStyle,
          backgroundColor: disabled ? Colors.neutral[100] : Colors.secondary[100],
          borderWidth: 1,
          borderColor: disabled ? Colors.neutral[200] : Colors.secondary[200],
        };
      case 'outline':
        return {
          ...baseStyle,
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: disabled ? Colors.neutral[300] : Colors.primary[500],
        };
      case 'ghost':
        return {
          ...baseStyle,
          backgroundColor: 'transparent',
        };
      default:
        return baseStyle;
    }
  };

  const getTextStyle = (): TextStyle => {
    const baseStyle: TextStyle = {
      fontWeight: Typography.fontWeight.semibold,
      ...getFontSizeForSize(),
    };

    switch (variant) {
      case 'primary':
        return {
          ...baseStyle,
          color: disabled ? Colors.neutral[500] : '#FFFFFF',
          textShadowColor: disabled ? 'transparent' : Colors.secondary[600],
          textShadowOffset: { width: 1, height: 1 },
          textShadowRadius: 2,
        };
      case 'secondary':
        return {
          ...baseStyle,
          color: disabled ? Colors.neutral[400] : Colors.text.primary,
        };
      case 'outline':
        return {
          ...baseStyle,
          color: disabled ? Colors.neutral[400] : Colors.primary[500],
        };
      case 'ghost':
        return {
          ...baseStyle,
          color: disabled ? Colors.neutral[400] : Colors.primary[500],
        };
      default:
        return baseStyle;
    }
  };

  const getPaddingForSize = () => {
    switch (size) {
      case 'small':
        return {
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
        };
      case 'large':
        return {
          paddingHorizontal: Spacing.xxl,
          paddingVertical: Spacing.lg,
        };
      case 'medium':
      default:
        return {
          paddingHorizontal: Spacing.lg,
          paddingVertical: Spacing.md,
        };
    }
  };

  const getFontSizeForSize = () => {
    switch (size) {
      case 'small':
        return { fontSize: Typography.fontSize.sm };
      case 'large':
        return { fontSize: Typography.fontSize.lg };
      case 'medium':
      default:
        return { fontSize: Typography.fontSize.base };
    }
  };

  return (
    <TouchableOpacity
      style={[getButtonStyle(), style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? Colors.text.inverse : Colors.primary[500]}
        />
      ) : (
        <>
          {icon && <>{icon}</>}
          <Text style={[getTextStyle(), textStyle, icon ? { marginLeft: Spacing.sm } : undefined]}>
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({});