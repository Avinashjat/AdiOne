/**
 * The AdiOne mark, as an in-app component.
 *
 * Renders the same asset as the launcher icon rather than a separate drawing,
 * so the icon a customer taps on their home screen and the mark they see on
 * the sign-in screen are provably identical — the usual way those drift is by
 * being two different files.
 */

import { Image, StyleSheet } from 'react-native';
import { radius } from '@shared/theme';

// Resolved at bundle time by Metro; the 1024px source downscales cleanly.
const SOURCE = require('../../assets/adione-icon.png') as number;

export default function BrandMark({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={SOURCE}
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size * 0.225 },
      ]}
      resizeMode="contain"
      accessibilityLabel="AdiOne"
    />
  );
}

const styles = StyleSheet.create({
  mark: { borderRadius: radius.lg },
});
