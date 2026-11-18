import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { START_COPY } from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import InvitationButton from "./InvitationButton";
import { INVITATION_BACKDROP } from "./invitationPhotos";
import { em, glass, lineHeight, palette, photoFill, typo } from "./invitationStyle";

const ORB_SIZE = 150;
const ORB_TOP = 210;
const ORB_MIN_GAP = 16;

/**
 * 시작 화면(`Main.dc`, 390×844). 로그인하지 않은 사람이 앱을 열면 보는 첫 화면이다.
 * 보케 사진을 화면 가득 깔고, 위에 로고, 가운데 오브, 아래에 반투명 카드를 둔다.
 * 카드의 `backdrop-filter: blur(24px)` 는 새 네이티브 모듈 없이 못 그려 같은 반투명 흰색만 쓴다.
 * 오브는 아티팩트 위치(위에서 210px)에 두되, 작은 화면에서 카드와 겹치면 카드 위로 올리고 줄인다.
 */
export default function InvitationStart({ onStart, onExample }: { onStart: () => void; onExample: () => void }) {
  const insets = useSafeAreaInsets();
  const [headerBottom, setHeaderBottom] = useState<number | null>(null);
  const [cardTop, setCardTop] = useState<number | null>(null);
  // 아티팩트(390×844)의 위 여백 64 는 상태 표시줄 47 을 품은 값이다. 더 높은 표시줄이면 그만큼 내린다.
  const paddingTop = Math.max(64, insets.top + 17);
  const preferredTop = ORB_TOP + (paddingTop - 64);

  let orbSize = ORB_SIZE;
  let orbTop = preferredTop;
  if (headerBottom !== null && cardTop !== null) {
    const room = cardTop - headerBottom - ORB_MIN_GAP * 2;
    orbSize = Math.min(ORB_SIZE, room);
    orbTop = Math.max(headerBottom + ORB_MIN_GAP, Math.min(preferredTop, cardTop - ORB_MIN_GAP - orbSize));
  }

  return (
    <View style={styles.root}>
      <Image
        source={INVITATION_BACKDROP}
        resizeMode="cover"
        style={photoFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View
        style={[styles.header, { paddingTop }]}
        onLayout={(event) => setHeaderBottom(event.nativeEvent.layout.y + event.nativeEvent.layout.height)}
      >
        <Text style={[typo.numeralMediumItalic, styles.wordmark]}>{START_COPY.wordmark}</Text>
        <Text style={[typo.sans, styles.tagline]}>{START_COPY.tagline}</Text>
      </View>
      {orbSize >= 72 ? (
        <View style={[styles.orb, { top: orbTop }]} pointerEvents="none">
          <AmoraOrb size={orbSize} mood="calm" />
        </View>
      ) : null}
      <View
        style={[styles.card, { paddingBottom: Math.max(22, insets.bottom - 12) }]}
        onLayout={(event) => setCardTop(event.nativeEvent.layout.y)}
      >
        <Text accessibilityRole="header" style={[typo.serif, styles.heading]}>
          {START_COPY.headingLines.join("\n")}
        </Text>
        <Text style={[typo.sans, styles.body]}>{START_COPY.body}</Text>
        <InvitationButton
          label={START_COPY.start}
          onPress={onStart}
          variant="ink"
          height={56}
          fontSize={16}
          weight="700"
          style={styles.start}
        />
        <InvitationButton label={START_COPY.example} onPress={onExample} variant="plain" height={44} fontSize={14} weight="500" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden", backgroundColor: palette.blush },
  header: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", gap: 4 },
  wordmark: { fontSize: 40, letterSpacing: em(40, 0.01), color: palette.white },
  tagline: { fontSize: 12, letterSpacing: em(12, 0.08), color: glass.tagline },
  orb: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: glass.startCard,
    borderRadius: 36,
    paddingTop: 32,
    paddingHorizontal: 26,
    gap: 14,
  },
  heading: { fontSize: 27, lineHeight: lineHeight(27, 1.45), letterSpacing: em(27, -0.01) },
  body: { fontSize: 15, lineHeight: lineHeight(15, 1.7), color: palette.body },
  start: { marginTop: 10 },
});
