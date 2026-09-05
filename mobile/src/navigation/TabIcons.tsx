/**
 * Bottom-tab glyphs.
 *
 * Drawn with plain Views rather than an icon font or react-native-svg. Both of
 * those are native dependencies, and adding one to get five small shapes would
 * mean a heavier APK and another thing that can break a prebuild.
 *
 * Each glyph is 22x22 and uses `currentColor` semantics via the `color` prop,
 * so the active/inactive tint is decided by the tab bar, not here.
 */

import { View, type ViewStyle } from 'react-native';

const SIZE = 22;

function Box({ style }: { style: ViewStyle }) {
  return <View style={style} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </View>
  );
}

export function HomeIcon({ color }: { color: string }) {
  return (
    <Frame>
      {/* Roof: a square rotated 45° and clipped by the body below it. */}
      <Box
        style={{
          position: 'absolute',
          top: 1,
          width: 13,
          height: 13,
          borderTopWidth: 2,
          borderLeftWidth: 2,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <Box
        style={{
          position: 'absolute',
          bottom: 1,
          width: 15,
          height: 10,
          borderWidth: 2,
          borderTopWidth: 0,
          borderColor: color,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
        }}
      />
    </Frame>
  );
}

export function CategoriesIcon({ color }: { color: string }) {
  const cell: ViewStyle = {
    width: 8,
    height: 8,
    borderWidth: 2,
    borderColor: color,
    borderRadius: 2,
  };
  return (
    <Frame>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        <Box style={cell} />
        <Box style={cell} />
      </View>
      <View style={{ flexDirection: 'row', gap: 3, marginTop: 3 }}>
        <Box style={cell} />
        <Box style={cell} />
      </View>
    </Frame>
  );
}

export function SearchIcon({ color }: { color: string }) {
  return (
    <Frame>
      <Box
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          borderWidth: 2,
          borderColor: color,
          marginTop: -2,
          marginLeft: -2,
        }}
      />
      <Box
        style={{
          position: 'absolute',
          right: 3,
          bottom: 3,
          width: 7,
          height: 2,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </Frame>
  );
}

export function CartIcon({ color }: { color: string }) {
  return (
    <Frame>
      {/* Handle */}
      <Box
        style={{
          position: 'absolute',
          top: 2,
          width: 10,
          height: 7,
          borderWidth: 2,
          borderBottomWidth: 0,
          borderColor: color,
          borderTopLeftRadius: 5,
          borderTopRightRadius: 5,
        }}
      />
      {/* Basket */}
      <Box
        style={{
          position: 'absolute',
          bottom: 2,
          width: 17,
          height: 12,
          borderWidth: 2,
          borderColor: color,
          borderRadius: 3,
        }}
      />
    </Frame>
  );
}

export function AccountIcon({ color }: { color: string }) {
  return (
    <Frame>
      <Box
        style={{
          position: 'absolute',
          top: 2,
          width: 9,
          height: 9,
          borderRadius: 5,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      {/* Shoulders: a wide rounded box with its lower half cut off by overflow. */}
      <Box
        style={{
          position: 'absolute',
          bottom: 1,
          width: 16,
          height: 9,
          borderWidth: 2,
          borderBottomWidth: 0,
          borderColor: color,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
      />
    </Frame>
  );
}
