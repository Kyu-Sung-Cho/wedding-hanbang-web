import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { colors } from "@hanbang/design-tokens";

export type CommunityAvatarRole = "bride" | "groom" | "neutral";

interface CommunityAvatarProps {
  nickname: string;
  role?: CommunityAvatarRole | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

type AvatarCharacter = {
  role: CommunityAvatarRole;
  bgTop: string;
  bgBottom: string;
  hair: string;
  outfit: string;
  accent: string;
  skin: string;
  blush: string;
  initial: string;
  hairVariant: number;
  accessoryVariant: number;
  expressionVariant: number;
};

const SKIN_TONES = ["#F2C9B3", "#E7B99E", "#D8A084", "#C78F72"];

const BRIDE_PALETTES = [
  { bgTop: colors.ivory[50], bgBottom: colors.rose.pale, hair: colors.stone[900], outfit: colors.ivory[50], accent: colors.rose[500], blush: "#E3A59B" },
  { bgTop: colors.ivory[100], bgBottom: colors.sage.pale, hair: "#2B241F", outfit: colors.surface, accent: colors.rose[600], blush: "#D99A8D" },
  { bgTop: colors.ivory[200], bgBottom: colors.gold.light, hair: "#41352D", outfit: colors.ivory[50], accent: colors.gold.DEFAULT, blush: "#EAB4A5" },
];

const GROOM_PALETTES = [
  { bgTop: colors.ivory[50], bgBottom: colors.sage.pale, hair: colors.stone[900], outfit: colors.noir[800], accent: colors.gold.DEFAULT, blush: "#D9A58F" },
  { bgTop: colors.ivory[100], bgBottom: colors.gold.light, hair: "#2B241F", outfit: colors.noir[900], accent: colors.rose[500], blush: "#D9A58F" },
  { bgTop: colors.ivory[200], bgBottom: colors.surfaceLow, hair: "#3A2E28", outfit: colors.taupe[500], accent: colors.rose[600], blush: "#D9A58F" },
];

const NEUTRAL_PALETTES = [
  { bgTop: colors.ivory[50], bgBottom: colors.gold.light, hair: colors.stone[900], outfit: colors.noir[800], accent: colors.rose[500], blush: "#E5B2A4" },
  { bgTop: colors.ivory[100], bgBottom: colors.sage.pale, hair: "#2B241F", outfit: colors.taupe[500], accent: colors.gold.DEFAULT, blush: "#E7B9A8" },
];

export function CommunityAvatar({
  nickname,
  role,
  size = 40,
  style,
}: CommunityAvatarProps) {
  const character = getAvatarCharacter(nickname, role);
  const gradientId = `community-avatar-${character.role}-${hashString(`${character.role}:${nickname}`)}`;

  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
      accessibilityLabel={`${nickname || "anonymous"} avatar`}
      accessibilityRole="image"
    >
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <LinearGradient id={gradientId} x1="10" y1="8" x2="56" y2="58">
            <Stop offset="0%" stopColor={character.bgTop} />
            <Stop offset="100%" stopColor={character.bgBottom} />
          </LinearGradient>
        </Defs>
        <Rect width="64" height="64" rx="32" fill={`url(#${gradientId})`} />
        {character.role === "bride" ? (
          <BrideAvatar character={character} />
        ) : character.role === "groom" ? (
          <GroomAvatar character={character} />
        ) : (
          <NeutralAvatar character={character} />
        )}
      </Svg>
    </View>
  );
}

function getAvatarCharacter(
  nickname: string,
  role: CommunityAvatarRole | null | undefined
): AvatarCharacter {
  const safeNickname = nickname.trim() || "anonymous";
  const avatarRole = role === "bride" || role === "groom" ? role : "neutral";
  const hash = hashString(`${avatarRole}:${safeNickname}`);
  const paletteSource =
    avatarRole === "bride"
      ? BRIDE_PALETTES
      : avatarRole === "groom"
        ? GROOM_PALETTES
        : NEUTRAL_PALETTES;
  const palette = paletteSource[hash % paletteSource.length]!;

  return {
    role: avatarRole,
    ...palette,
    skin: SKIN_TONES[Math.floor(hash / 7) % SKIN_TONES.length]!,
    initial: safeNickname.charAt(0).toUpperCase(),
    hairVariant: Math.floor(hash / 11) % 3,
    accessoryVariant: Math.floor(hash / 17) % 3,
    expressionVariant: Math.floor(hash / 23) % 3,
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function Eyes({ character }: { character: AvatarCharacter }) {
  return (
    <G>
      <Circle cx="27" cy="29" r="1.6" fill={colors.noir[800]} />
      <Circle cx="37" cy="29" r="1.6" fill={colors.noir[800]} />
      <Circle cx="25" cy="34" r="2" fill={character.blush} opacity="0.55" />
      <Circle cx="39" cy="34" r="2" fill={character.blush} opacity="0.55" />
      {character.expressionVariant === 0 ? (
        <Path d="M28.5 38c2.1 1.6 4.9 1.6 7 0" fill="none" stroke={colors.rose[600]} strokeWidth="1.6" strokeLinecap="round" />
      ) : character.expressionVariant === 1 ? (
        <Path d="M29 37.5c1.8 1 4.2 1 6 0" fill="none" stroke={colors.rose[600]} strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <Circle cx="32" cy="38" r="1.35" fill={colors.rose[600]} opacity="0.8" />
      )}
    </G>
  );
}

function BrideAvatar({ character }: { character: AvatarCharacter }) {
  return (
    <G>
      <Path
        d={
          character.hairVariant === 0
            ? "M18 33c0-14 7-24 14-24s14 10 14 24v13c-6 7-22 7-28 0V33z"
            : character.hairVariant === 1
              ? "M17 35c1-15 8-25 16-25 7 0 13 9 14 23 1 8-3 14-8 17H25c-5-3-9-8-8-15z"
              : "M19 34c0-15 8-24 15-24 8 0 13 10 12 25l-2 14H21l-2-15z"
        }
        fill={character.hair}
      />
      <Path d="M20 55c3.4-8.2 7.4-12.2 12-12.2S40.6 46.8 44 55H20z" fill={character.outfit} />
      <Path d="M22 55c2.8-6 6.1-8.9 10-8.9S39.2 49 42 55" fill="none" stroke={character.accent} strokeWidth="1.4" strokeLinecap="round" />
      <Circle cx="32" cy="29" r="13" fill={character.skin} />
      <Path d="M20 27c3-9 9-13 17-11 5 1 8 5 9 11-5-2-9-5-12-9-2 4-7 7-14 9z" fill={character.hair} />
      {character.hairVariant === 2 ? (
        <Path d="M39 18c5 3 7 8 7 16" fill="none" stroke={character.hair} strokeWidth="5" strokeLinecap="round" />
      ) : null}
      <Eyes character={character} />
      {character.accessoryVariant === 0 ? (
        <G>
          <Circle cx="43" cy="22" r="2.2" fill={character.accent} />
          <Circle cx="47" cy="22" r="1.4" fill={colors.ivory[50]} />
        </G>
      ) : character.accessoryVariant === 1 ? (
        <Path d="M22 21c4-4 11-6 18-3" fill="none" stroke={character.accent} strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <G fill={character.accent}>
          <Circle cx="28" cy="48" r="1" />
          <Circle cx="32" cy="49" r="1" />
          <Circle cx="36" cy="48" r="1" />
        </G>
      )}
    </G>
  );
}

function GroomAvatar({ character }: { character: AvatarCharacter }) {
  return (
    <G>
      <Path d="M18 55c2.5-8.5 7-12.8 14-12.8S43.5 46.5 46 55H18z" fill={character.outfit} />
      <Path d="M27 44l5 5 5-5 2 11H25l2-11z" fill={colors.ivory[50]} opacity="0.95" />
      <Path d="M31 48h2l2 7h-6l2-7z" fill={character.accent} />
      <Circle cx="32" cy="29" r="13" fill={character.skin} />
      <Path
        d={
          character.hairVariant === 0
            ? "M20 27c1-10 8-16 17-15 6 1 9 6 9 14-8-1-14-3-20-8-1 4-3 7-6 9z"
            : character.hairVariant === 1
              ? "M20 27c2-9 8-15 16-14 5 1 8 4 10 9-5-1-10-1-15 0-4 1-7 3-11 5z"
              : "M19 28c1-11 8-17 17-16 6 1 10 6 10 14-4-3-8-5-13-5-5 0-9 2-14 7z"
        }
        fill={character.hair}
      />
      <Eyes character={character} />
      {character.accessoryVariant === 0 ? (
        <Path d="M24 26h5M35 26h5" stroke={colors.noir[800]} strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      ) : character.accessoryVariant === 1 ? (
        <Path d="M24 19c3-2 7-3 12-2" fill="none" stroke={character.accent} strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <Circle cx="42" cy="43" r="1.6" fill={character.accent} />
      )}
    </G>
  );
}

function NeutralAvatar({ character }: { character: AvatarCharacter }) {
  return (
    <G>
      <Circle cx="32" cy="27" r="13" fill={character.skin} />
      <Path d="M20 27c2-9 8-14 16-14 6 0 10 4 10 11-8 0-15-2-21-6-1 4-3 7-5 9z" fill={character.hair} />
      <Path d="M19 55c3-8 7.4-12 13-12s10 4 13 12H19z" fill={character.outfit} />
      <Circle cx="32" cy="49" r="7.5" fill="#FFFFFF" opacity="0.18" />
      <SvgText x="32" y="53" textAnchor="middle" fontSize="11" fontWeight="700" fill="#FFFFFF" opacity="0.82">
        {character.initial}
      </SvgText>
      <Eyes character={character} />
      <Circle cx="46" cy="19" r="2" fill={character.accent} opacity="0.85" />
    </G>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
    backgroundColor: colors.ivory[100],
  },
});
