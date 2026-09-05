/**
 * Category icon.
 *
 * Categories carry an optional `imageUrl` that the shop can set from the admin
 * panel. Until they do, the app showed an empty grey circle for every
 * category, which is worse than useless — it reads as a broken image and gives
 * the customer nothing to scan for.
 *
 * The fallback is an emoji chosen by matching keywords in the category name.
 * That is a deliberate trade: emoji render at any size, need no network, no
 * asset pipeline and no storage, they are already localised by the platform,
 * and a customer scanning a rail recognises 🥛 far faster than they read
 * "Milk & Dairy". A real uploaded image always wins when one exists.
 *
 * Matching is on the name rather than a fixed id map so a category the shop
 * adds later still gets a sensible icon instead of the generic bag.
 */

import { Image, StyleSheet, View } from "react-native";
import { colors, radius } from "@shared/theme";
import { AppText } from "./ui";
import { resolveImageUrl } from "@/lib/api";

/**
 * Ordered: the first match wins, so put specific terms before generic ones.
 * "baby" must beat "care", and "ice cream" must beat "cream".
 */
const RULES: { match: RegExp; emoji: string }[] = [
  { match: /baby|diaper|infant/i, emoji: "🍼" },
  { match: /atta|flour|rice|dal|pulse|grain|staple/i, emoji: "🌾" },
  { match: /oil|ghee|vanaspati/i, emoji: "🫗" },
  { match: /masala|spice|salt|namak/i, emoji: "🌶️" },
  { match: /tea|coffee|drink|beverage|juice|water/i, emoji: "☕" },
  { match: /biscuit|snack|namkeen|chips|cookie/i, emoji: "🍪" },
  { match: /milk|dairy|curd|paneer|butter|cheese/i, emoji: "🥛" },
  { match: /noodle|pasta|vermicelli|maggi/i, emoji: "🍜" },
  { match: /sauce|spread|ketchup|jam|pickle|achar/i, emoji: "🥫" },
  { match: /sweet|sugar|honey|jaggery|gur/i, emoji: "🍯" },
  { match: /packaged|ready|instant|frozen/i, emoji: "🧊" },
  { match: /household|clean|detergent|utensil|dishwash/i, emoji: "🧽" },
  { match: /personal|soap|shampoo|toothpaste|hygiene|care/i, emoji: "🧴" },
  { match: /fruit|vegetable|veg|sabzi|fresh/i, emoji: "🥬" },
  { match: /egg|meat|chicken|fish|non.?veg/i, emoji: "🥚" },
  { match: /bread|bakery|cake|bun/i, emoji: "🍞" },
  { match: /chocolate|candy|confection/i, emoji: "🍫" },
  { match: /pet|dog|cat/i, emoji: "🐾" },
  { match: /stationer|office|book/i, emoji: "✏️" },
];

/** Generic enough to never look wrong, specific enough to read as "goods". */
const FALLBACK = "🛍️";

export function categoryEmoji(name: string): string {
  for (const rule of RULES) {
    if (rule.match.test(name)) return rule.emoji;
  }
  return FALLBACK;
}

export default function CategoryIcon({
  name,
  imageUrl,
  size = 56,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const box = {
    width: size,
    height: size,
    borderRadius: radius.circle,
  };

  if (imageUrl) {
    return (
      <Image
        source={{
          uri: resolveImageUrl(imageUrl) ?? undefined,
        }}
        style={[box, styles.image]}
        resizeMode="cover"
        accessibilityLabel={name}
      />
    );
  }

  return (
    <View style={[box, styles.emojiBox]} accessibilityLabel={name}>
      {/* Line height matched to font size: the default leading pushes an emoji
          visibly off-centre inside a circle. */}
      <AppText style={{ fontSize: size * 0.46, lineHeight: size * 0.56 }}>
        {categoryEmoji(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.surfaceMuted },
  emojiBox: {
    backgroundColor: colors.primarySurface,
    alignItems: "center",
    justifyContent: "center",
  },
});
