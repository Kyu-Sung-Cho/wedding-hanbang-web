import { Text, View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import { colors } from "@hanbang/design-tokens";
import { normalizeMobileCommunityAvatar } from "@/lib/communityPublicPayload";

interface CommunityAvatarProps {
  nickname: string;
  avatarUrl?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const PALETTES = [
  { top: colors.ivory[50], bottom: colors.gold.light, hair: colors.stone[900], outfit: colors.noir[800], accent: colors.rose[500], skin: "#F2C9B3" },
  { top: colors.ivory[100], bottom: colors.sage.pale, hair: "#2B241F", outfit: colors.taupe[500], accent: colors.gold.DEFAULT, skin: "#E7B99E" },
  { top: colors.ivory[200], bottom: colors.sage.pale, hair: "#41352D", outfit: colors.noir[800], accent: colors.rose[600], skin: "#D8A084" },
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function CommunityAvatar({ nickname, avatarUrl, size = 40, style }: CommunityAvatarProps) {
  const safeNickname = nickname.trim() || "커뮤니티 사용자";
  const emoji = normalizeMobileCommunityAvatar(avatarUrl);
  if (emoji) {
    return (
      <View
        style={[
          styles.frame,
          styles.emojiFrame,
          { width: size, height: size, borderRadius: size / 2 },
          style,
        ]}
        accessibilityLabel={`${safeNickname} 아바타`}
        accessibilityRole="image"
      >
        <Text style={{ fontSize: size * 0.5, lineHeight: size * 0.64 }}>{emoji}</Text>
      </View>
    );
  }
  const hash = hashString(safeNickname);
  const palette = PALETTES[hash % PALETTES.length]!;
  const gradientId = `community-avatar-neutral-${hash}`;

  return (
    <View
      style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }, style]}
      accessibilityLabel={`${safeNickname} 아바타`}
      accessibilityRole="image"
    >
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <LinearGradient id={gradientId} x1="10" y1="8" x2="56" y2="58">
            <Stop offset="0%" stopColor={palette.top} />
            <Stop offset="100%" stopColor={palette.bottom} />
          </LinearGradient>
        </Defs>
        <Rect width="64" height="64" rx="32" fill={`url(#${gradientId})`} />
        <Circle cx="32" cy="27" r="13" fill={palette.skin} />
        <Path d="M20 27c2-9 8-14 16-14 6 0 10 4 10 11-8 0-15-2-21-6-1 4-3 7-5 9z" fill={palette.hair} />
        <Path d="M19 55c3-8 7.4-12 13-12s10 4 13 12H19z" fill={palette.outfit} />
        <Circle cx="27" cy="29" r="1.6" fill={colors.noir[800]} />
        <Circle cx="37" cy="29" r="1.6" fill={colors.noir[800]} />
        <Path d="M28.5 38c2.1 1.6 4.9 1.6 7 0" fill="none" stroke={colors.rose[600]} strokeWidth="1.6" strokeLinecap="round" />
        <Circle cx="46" cy="19" r="2" fill={palette.accent} opacity="0.85" />
        <Circle cx="32" cy="49" r="7.5" fill="#FFFFFF" opacity="0.18" />
        <SvgText x="32" y="53" textAnchor="middle" fontSize="11" fontWeight="700" fill="#FFFFFF" opacity="0.82">
          {safeNickname.charAt(0).toUpperCase()}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
    backgroundColor: colors.ivory[100],
  },
  emojiFrame: {
    alignItems: "center",
    justifyContent: "center",
  },
});
