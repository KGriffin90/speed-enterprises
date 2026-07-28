import React from 'react';
import { View } from 'react-native';

/** Stand-in for SVG imports (real ones go through react-native-svg-transformer in Metro). */
export default function SvgMock(props: any) {
  return <View {...props} />;
}
