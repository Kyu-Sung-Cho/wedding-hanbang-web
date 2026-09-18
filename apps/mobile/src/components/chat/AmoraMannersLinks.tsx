import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { BookOpen, ChevronRight } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { Text } from "@/components/ui/AppText";
import type { AmoraMannersLink } from "@/lib/amoraCitations.mjs";
import { buildMobileSiteUrl } from "@/lib/siteUrl.mjs";

/**
 * 아모라 답 아래의 결혼 예절 안내 편 카드(2026-09-18, wave 2 · 2.7).
 *
 * 아모라가 `[etiquette:N]` 으로 가리킨 편을 웹 채팅처럼 카드로 보여 준다. 편은 앱 안 웹 화면으로 연다
 * (예절 안내는 웹 화면을 쓰기로 한 파운더 결정). 주소는 사이트 주소 헬퍼로만 짓는다 — 운영에서
 * 사이트 주소가 없으면 헬퍼가 던진다. 하드코딩한 기본 주소로 몰래 넘어가지 않는다.
 *
 * 카드에는 편 제목과 부제만 둔다. 이 편을 「근거」로 답했다고 말하지 않는다 — 아모라는 편 본문을 받지
 * 않으니 그 말은 사실이 아니다. 더 읽을 곳일 뿐이다.
 */
export function mannersPartWebviewRoute(slug: string, siteOrigin: string): string {
  return `/webview?url=${encodeURIComponent(buildMobileSiteUrl(`/wedding/manners/${slug}`, siteOrigin))}`;
}

export default function AmoraMannersLinks({
  links,
  siteOrigin,
}: {
  links: readonly AmoraMannersLink[];
  siteOrigin: string;
}) {
  if (links.length === 0) return null;
  return (
    <View style={styles.list}>
      {links.map((link) => (
        <Pressable
          key={link.slug}
          accessibilityRole="link"
          accessibilityLabel={`${link.title} 예절 안내 열기`}
          onPress={() => router.push(mannersPartWebviewRoute(link.slug, siteOrigin))}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <BookOpen size={15} color={colors.rose[700]} />
          </View>
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>{link.title}</Text>
            <Text style={styles.subtitle} numberOfLines={2}>{link.subtitle}</Text>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ChevronRight size={14} color={colors.textTertiary} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: spacing[2], gap: spacing[1] },
  card: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.rose.pale,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 13, fontWeight: "600", color: colors.noir[800] },
  subtitle: { fontSize: 11, lineHeight: 16, color: colors.textTertiary },
});
