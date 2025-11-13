import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  View,
  ViewProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, Edge } from 'react-native-safe-area-context';

type KeyboardBehavior = 'padding' | 'height' | 'position';

interface KeyboardSafeViewProps extends ViewProps {
  /**
   * Additional offset added to the calculated safe-area top inset.
   * Useful when screens render within nested headers or tab bars.
   */
  offset?: number;
  /**
   * Override the default keyboard avoidance behavior.
   */
  behavior?: KeyboardBehavior;
  /**
   * Optional style applied to the inner content wrapper.
   */
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Safe-area edges to apply padding to. Defaults to top/left/right to let
   * KeyboardAvoidingView manage the bottom inset.
   */
  edges?: Edge[];
}

const baseFlex: ViewStyle = { flex: 1 };

const KeyboardSafeView: React.FC<KeyboardSafeViewProps> = ({
  children,
  style,
  contentStyle,
  offset,
  behavior,
  edges = ['top', 'left', 'right'],
  ...rest
}) => {
  const insets = useSafeAreaInsets();
  const keyboardVerticalOffset = offset ?? (insets.top || 0) + 8;

  return (
    <SafeAreaView style={[baseFlex, style]} edges={edges}>
      <KeyboardAvoidingView
        style={baseFlex}
        behavior={behavior ?? (Platform.OS === 'ios' ? 'padding' : 'height')}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <View style={[baseFlex, contentStyle]} {...rest}>
          {children}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default KeyboardSafeView;

