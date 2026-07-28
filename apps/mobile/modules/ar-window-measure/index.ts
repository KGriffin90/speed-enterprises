import type { ComponentType } from 'react';
import { requireNativeViewManager } from 'expo-modules-core';
import { ViewProps } from 'react-native';

// ── Types ─────────────────────────────────────────────────────────────────

export interface MeasurementResult {
  widthMeters:  number;
  heightMeters: number;
  widthInches:  number;
  heightInches: number;
  widthFeet:    number;
  heightFeet:   number;
  widthDisplay:  string;  // e.g. "36.2\""
  heightDisplay: string;  // e.g. "48.5\""
}

export interface SteadinessEvent {
  stable:   boolean;
  movement: number;   // 0-1 scale (0=perfectly still)
}

export interface DetectionEvent {
  detected:   boolean;
  confidence: number;
}

export interface CornerAddedEvent {
  count:   number;  // 1-4
  screenX: number;
  screenY: number;
}

export interface ARWindowMeasureViewProps extends ViewProps {
  mode:    'auto' | 'manual';
  command: null | { type: 'reset' } | { type: 'addCorner'; x: number; y: number };
  onDetected?:    (event: { nativeEvent: DetectionEvent })   => void;
  onSteadiness?:  (event: { nativeEvent: SteadinessEvent })  => void;
  onMeasurement?: (event: { nativeEvent: MeasurementResult }) => void;
  onCornerAdded?: (event: { nativeEvent: CornerAddedEvent }) => void;
  onReady?:       (event: { nativeEvent: {} })               => void;
  onError?:       (event: { nativeEvent: { message: string } }) => void;
}

// ── Native view export ────────────────────────────────────────────────────

export const ARWindowMeasureView: ComponentType<ARWindowMeasureViewProps> =
  requireNativeViewManager('ARWindowMeasure');

export default ARWindowMeasureView;
