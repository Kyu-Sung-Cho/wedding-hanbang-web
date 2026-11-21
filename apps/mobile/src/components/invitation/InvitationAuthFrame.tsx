import type { ReactNode } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { START_COPY } from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import { INVITATION_BACKDROP } from "./invitationPhotos";
import { em, glass, lineHeight, palette, photoFill, typo } from "./invitationStyle";

/**
 * 로그인·회원가입·비밀번호 찾기·동의가 함께 쓰는 부품. 2026-11-20 파운더 원문: "근데 로그인 페이지도  다 바궈야할듯해".
 *
 * 디자인 시안에는 로그인 화면이 없어서, 바로 앞 화면인 시작 화면(`InvitationStart`, 시안 `Main.dc`)의 모양을 잇는다.
 *   - 바탕: 보케 사진을 화면 가득(`InvitationAuthBackground`).
 *   - 위: amora(Cormorant 이탤릭 500, 40px, 흰색)와 한 줄(12px, 흰색 90%), 그 아래 오브(`InvitationAuthHeader`).
 *   - 아래: 흰색 86% 유리 카드, 반경 36, 안쪽 위 32·옆 26·아래 22, 사이 14(`InvitationAuthCard`). 네이티브는 흐림 없이 같은 색만 쓴다.
 * 화면마다 안전 영역·키보드·스크롤 구조는 그대로 두고 이 부품만 넣는다. 로그인 방법과 동작은 화면 파일 그대로다.
 * 자간은 시작 화면과 같은 두 줄(amora, 한 줄)에만 있다(DESIGN.md "아티팩트의 한글 자간은 그대로 둔다").
 */
export function InvitationAuthBackground({ children }: { children: ReactNode }) {
  return (
    <View style={styles.root}>
      <Image
        source={INVITATION_BACKDROP}
        resizeMode="cover"
        style={photoFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {children}
    </View>
  );
}

/** amora 와 한 줄, 그 아래 오브. 이름이 바로 위에 적혀 있어 오브는 읽어 주지 않는다. */
export function InvitationAuthHeader() {
  return (
    <View style={styles.header}>
      <Text style={[typo.numeralMediumItalic, styles.wordmark]}>{START_COPY.wordmark}</Text>
      <Text style={[typo.sans, styles.tagline]}>{START_COPY.tagline}</Text>
      <View
        style={styles.orb}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <AmoraOrb size={88} mood="calm" />
      </View>
    </View>
  );
}

export function InvitationAuthCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** 네 화면이 함께 쓰는 글자 모양. 색은 청첩장 팔레트에서만 읽는다. */
export const authText = StyleSheet.create({
  heading: { ...typo.serif, fontSize: 24, lineHeight: lineHeight(24, 1.45) },
  body: { ...typo.sans, fontSize: 15, lineHeight: lineHeight(15, 1.7), color: palette.body },
  hint: { ...typo.sans, fontSize: 12, lineHeight: 18, color: palette.muted, marginTop: 6, marginLeft: 6 },
  error: { ...typo.sans, fontSize: 12, lineHeight: 18, color: palette.warn, marginTop: 6, marginLeft: 6 },
  alert: { ...typo.sansMedium, fontSize: 13, lineHeight: 20, color: palette.warn },
  link: { ...typo.sans, fontSize: 14, lineHeight: 20, color: palette.body },
  linkStrong: { ...typo.sansMedium, fontSize: 14, lineHeight: 20, color: palette.ink },
  small: { ...typo.sans, fontSize: 12, lineHeight: 18, color: palette.muted },
  dividerText: { ...typo.sans, fontSize: 12, lineHeight: 18, color: palette.muted },
});

/** 입력칸·먹색 알약·구분선·소셜 알약. 소셜 단추의 브랜드 색은 화면 파일에 남긴다. */
export const authField = StyleSheet.create({
  input: {
    ...typo.sans,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.chipLine,
    backgroundColor: palette.white,
    paddingHorizontal: 18,
    fontSize: 15,
  },
  inputError: { borderColor: palette.warn },
  primary: {
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  primaryText: { ...typo.sansBold, fontSize: 16, color: palette.white },
  pill: {
    width: "100%",
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  pillOutline: { borderWidth: 1, borderColor: palette.chipLine, backgroundColor: palette.white },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: palette.divider },
  alertBox: { borderRadius: 20, backgroundColor: palette.stone, paddingHorizontal: 14, paddingVertical: 12 },
});

/**
 * 가입·동의 화면의 약관 묶음. 웹 `SignupConsent` 와 같은 흰 칸, 반경 20, 먹색 체크다.
 * 빈 칸 동그라미는 흰 바탕에서 3:1 을 넘는 `faint`(3.77:1)로 그린다. `dashed`(1.54:1)는 법적 동의 칸이 안 보인다.
 */
export const authAgreement = StyleSheet.create({
  section: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.chipLine,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  allText: { ...typo.sansMedium, fontSize: 15, lineHeight: 22, color: palette.ink, flex: 1 },
  text: { ...typo.sans, fontSize: 14, lineHeight: 20, color: palette.body, flex: 1 },
  required: { ...typo.sansMedium, color: palette.ink },
  optional: { ...typo.sansMedium, color: palette.muted },
  link: { ...typo.sans, fontSize: 13, lineHeight: 18, color: palette.muted, textDecorationLine: "underline" },
  divider: { height: 1, backgroundColor: palette.divider },
});

/**
 * 입력칸 안 흐린 글자와 아이콘 색, 동의 칸의 체크 색.
 * 흐린 글자는 `muted`(흰 바탕 5.64:1)다. 입력칸 이름을 겸하는 글자라 4.5:1 을 넘어야 하고, 옛 화면도
 * 그 이상이었다(#6E5A54 6.28:1). 더 옅은 `faint`(3.77:1)는 동의 빈 칸 테두리처럼 글자가 아닌 곳에만 쓴다.
 */
export const authColors = {
  placeholder: palette.muted,
  icon: palette.muted,
  ink: palette.ink,
  white: palette.white,
  checked: palette.ink,
  unchecked: palette.faint,
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden", backgroundColor: palette.blush },
  header: { alignItems: "center", gap: 4, paddingTop: 24 },
  wordmark: { fontSize: 40, letterSpacing: em(40, 0.01), color: palette.white },
  tagline: { fontSize: 12, letterSpacing: em(12, 0.08), color: glass.tagline },
  orb: { marginTop: 24, marginBottom: 8, alignItems: "center" },
  card: {
    backgroundColor: glass.startCard,
    borderRadius: 36,
    paddingTop: 32,
    paddingHorizontal: 26,
    paddingBottom: 22,
    gap: 14,
  },
});
