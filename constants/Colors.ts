export const Colors = {
  // Primary Brand Colors
  primary: {
    50: '#e6f3ff',
    100: '#cce7ff',
    200: '#99cfff',
    300: '#66b7ff',
    400: '#339fff',
    500: '#FFEB3B',
    600: '#fdd835',
    700: '#f9a825',
    800: '#f57f17',
    900: '#e65100',
  },
  
  // Secondary Colors
  secondary: {
    50: '#e1f5fe',
    100: '#b3e5fc',
    200: '#81d4fa',
    300: '#4fc3f7',
    400: '#29b6f6',
    500: '#0288D1',
    600: '#0277bd',
    700: '#01579b',
    800: '#0d47a1',
    900: '#01579b',
  },
  
  // Success Colors
  success: {
    50: '#f0f8f4',
    100: '#dcf0e7',
    200: '#bbe1d0',
    300: '#86ccac',
    400: '#4db380',
    500: '#22a05e',
    600: '#16874a',
    700: '#15703d',
    800: '#165934',
    900: '#14482d',
  },
  
  // Warning Colors
  warning: {
    50: '#fdf9eb',
    100: '#faf0c7',
    200: '#f5e08a',
    300: '#f0cd4d',
    400: '#ebba24',
    500: '#e6a70b',
    600: '#c78f06',
    700: '#a47509',
    800: '#825c0e',
    900: '#66460f',
  },
  
  // Error Colors
  error: {
    50: '#fdf2f2',
    100: '#fce2e2',
    200: '#f9caca',
    300: '#f5a5a5',
    400: '#f07171',
    500: '#ea4444',
    600: '#d12626',
    700: '#b01c1c',
    800: '#8f1b1b',
    900: '#751d1d',
  },
  
  // Neutral Colors
  neutral: {
    50: '#f9f9f9',
    100: '#f0f0f0',
    200: '#e0e0e0',
    300: '#c7c7c7',
    400: '#a0a0a0',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#2C2C2C',
    900: '#171717',
  },
  
  // Semantic Colors
  background: '#E0F7FA',
  surface: '#ffffff',
  surfaceElevated: '#ffffff',
  border: '#FFEB3B',
  borderLight: '#fff59d',
  text: {
    primary: '#0D1B2A',
    secondary: '#37474f',
    tertiary: '#546e7a',
    inverse: '#ffffff',
  },
  
  // Chat Colors
  chat: {
    userBubble: '#004E89',
    contactBubble: '#F7E9D7',
    aiBubble: '#F45B69',
    systemBubble: '#4db380',
  },
  
  // Status Colors
  status: {
    online: '#22a05e',
    away: '#e6a70b',
    offline: '#737373',
  },
};

export const Shadows = {
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const BorderRadius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  full: 9999,
};

export const Typography = {
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
};