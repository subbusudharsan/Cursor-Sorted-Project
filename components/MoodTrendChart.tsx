import React, { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Text as SvgText, Line, Rect, G } from 'react-native-svg';
import { Colors, Typography } from '@/constants/Colors';

type MoodTrendPoint = {
  id: string;
  dateLabel: string;
  mood: string | null;
  intensity: number;
  accent: string;
  chatId?: string | null;
};

interface MoodTrendChartProps {
  data: MoodTrendPoint[];
  onSelectPoint?: (point: MoodTrendPoint) => void;
}

const HEIGHT = 160;
const VERTICAL_PADDING = 24;
const STEP_WIDTH = 80;
const BASELINE = HEIGHT - VERTICAL_PADDING;

const fallbackAccent = '#6366f1';

const MoodTrendChart: React.FC<MoodTrendChartProps> = ({ data, onSelectPoint }) => {
  const points = useMemo(() => {
    if (!data.length) return [] as (MoodTrendPoint & { x: number; y: number })[];
    const maxIntensity = Math.max(...data.map((d) => d.intensity || 1), 1);
    return data.map((point, index) => {
      const x = VERTICAL_PADDING + index * STEP_WIDTH;
      const normalized = (point.intensity || 1) / maxIntensity;
      const y = BASELINE - normalized * (HEIGHT - VERTICAL_PADDING * 2);
      return { ...point, x, y };
    });
  }, [data]);

  if (points.length === 0) {
    return null;
  }

  const width = Math.max(points.length * STEP_WIDTH + VERTICAL_PADDING * 2, 320);
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <Svg width={width} height={HEIGHT}>
        {/* Baseline */}
        <Line x1={VERTICAL_PADDING} y1={BASELINE} x2={width - VERTICAL_PADDING} y2={BASELINE} stroke={Colors.borderLight} strokeWidth={1} />

        {/* Trend line */}
        <Polyline
          points={polylinePoints}
          fill="none"
          stroke={Colors.primary[500]}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((point) => {
          const accent = point.accent || fallbackAccent;
          return (
            <G
              key={point.id}
              onPress={() => {
                onSelectPoint?.(point);
              }}
            >
              <Rect
                x={point.x - 20}
                y={VERTICAL_PADDING}
                width={40}
                height={BASELINE - VERTICAL_PADDING + 24}
                fill="transparent"
              />
              <Circle cx={point.x} cy={point.y} r={8} fill={Colors.background} stroke={accent} strokeWidth={2} />
              <Circle cx={point.x} cy={point.y} r={4} fill={accent} />
              <SvgText
                x={point.x}
                y={point.y - 14}
                fontSize={11}
                fill={accent}
                textAnchor="middle"
              >
                {point.mood ?? '—'}
              </SvgText>
              <SvgText
                x={point.x}
                y={BASELINE + 16}
                fontSize={10}
                fill={Colors.text.tertiary}
                textAnchor="middle"
              >
                {point.dateLabel}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 0,
  },
});

export type { MoodTrendPoint };
export default MoodTrendChart;
