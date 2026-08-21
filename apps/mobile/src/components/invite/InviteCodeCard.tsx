/**
 * 초대 코드를 "보낼 수 있는 것"으로 만드는 카드 — 복사 · 공유 · QR 한 자리.
 *
 * ## 왜 컴포넌트로 뺐는가
 *
 * 코드를 보여주는 자리는 두 곳이다. 온보딩 완료 화면과 설정의 파트너 관리.
 * 완료 화면은 코드를 글자 세 줄로만 그려서 누를 수 있는 것이 하나도 없었고,
 * 사람은 `WH-` + 12자리를 손으로 옮겨 적어야 했다. 설정에는 복사만 있었다.
 * 두 자리가 각자 다른 만큼만 도와주면, 어느 쪽으로 들어왔느냐가 연결 성공률을
 * 가른다. 그래서 "코드를 파트너에게 보내는 일"은 한 벌만 둔다.
 *
 * ## 복사는 이 카드가 하지 않는다
 *
 * 초대 코드는 커플 공간에 들어오는 열쇠다. 설정 화면은 지금 로그인한 사람의
 * 코드가 맞는지 확인한 뒤에만 클립보드에 넣는다 — 화면이 들고 있는 방어다.
 * 카드가 클립보드를 직접 만지면 그 방어를 우회하는 두 번째 경로가 생기므로,
 * 복사는 항상 화면이 넘겨준 `onCopy`를 부르기만 한다.
 *
 * ## QR은 카메라 권한 없이 된다
 *
 * 우리가 하는 일은 QR을 **그려서 보여주는 것**뿐이다. 읽는 쪽은 파트너 폰의
 * 기본 카메라다(iOS·Android 모두 기본 인식). 그래서 앱에 스캐너를 넣지 않았고,
 * 안내 문구도 "우리 앱으로 찍으세요"라고 말하지 않는다 — 없는 기능이다.
 *
 * ## 코드가 없으면 아무것도 그리지 않는다
 *
 * 두 사람이 연결된 뒤 `/api/couple/code`는 `inviteCode: null`을 준다(의도된
 * fail-closed). 그때 빈 QR이나 "null" 글자를 그리면, 이미 연결된 사람에게
 * 아직 초대할 것이 남은 것처럼 보인다. 형식 검사를 통과하지 못하면 컴포넌트가
 * null을 반환해 카드 자체가 사라진다.
 */

import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Check, Copy, Share2 } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  buildCoupleInviteShareMessage,
  buildCoupleInviteShareUrl,
  isCoupleInviteCode,
  normalizeCoupleInviteCode,
} from "@hanbang/shared";
import { resolveMobileSiteOrigin } from "@/lib/siteUrl.mjs";

const QR_SIZE = 168;

export type InviteCodeCardTone = "light" | "dark";

export type InviteCodeCardProps = {
  /** 서버가 준 초대 코드. 형식을 통과하지 못하면 카드는 렌더되지 않는다. */
  code: string | null | undefined;
  /** 복사는 화면이 한다 — 클립보드 방어를 카드가 우회하지 않도록. */
  onCopy: () => void;
  /** 화면이 들고 있는 "복사됨" 표시. 카드는 그 상태를 만들지 않는다. */
  copied?: boolean;
  copyDisabled?: boolean;
  label?: string;
  tone?: InviteCodeCardTone;
  style?: StyleProp<ViewStyle>;
};

/**
 * 링크·QR에 쓸 origin. 못 구하면 null을 돌려 QR과 링크를 아예 빼고 복사만 남긴다 —
 * 깨진 링크를 파트너에게 보내는 것보다 코드만 보내는 편이 낫다.
 */
function resolveShareOrigin(): string | null {
  try {
    return resolveMobileSiteOrigin(process.env.EXPO_PUBLIC_SITE_URL, {
      isDevelopment: __DEV__,
    });
  } catch {
    return null;
  }
}

export default function InviteCodeCard({
  code,
  onCopy,
  copied = false,
  copyDisabled = false,
  label = "초대 코드",
  tone = "light",
  style,
}: InviteCodeCardProps) {
  const [sharing, setSharing] = useState(false);

  const normalizedCode = normalizeCoupleInviteCode(code);
  const validCode = isCoupleInviteCode(normalizedCode) ? normalizedCode : null;

  // QR 값은 https 링크 그대로다. 기본 카메라가 열 수 있어야 하므로 커스텀 스킴을
  // 넣지 않는다. 코드는 링크의 `#` 뒤에 있어서 서버 접근 로그·리퍼러에 남지 않는다.
  const shareUrl = useMemo(
    () => buildCoupleInviteShareUrl({ code: validCode, origin: resolveShareOrigin() }),
    [validCode],
  );
  const shareMessage = useMemo(
    () => buildCoupleInviteShareMessage({ code: validCode, url: shareUrl }),
    [validCode, shareUrl],
  );

  async function handleShare() {
    if (!shareMessage || sharing) return;
    setSharing(true);
    try {
      // 링크는 이미 문구 안에 들어 있다. `url`로 한 번 더 넘기면 메신저에 따라
      // 같은 주소가 두 번 붙는다.
      await Share.share({ message: shareMessage });
    } catch {
      Alert.alert(
        "공유하지 못했어요",
        "다시 시도하거나, 코드를 복사해 파트너에게 보내주세요.",
      );
    } finally {
      setSharing(false);
    }
  }

  if (!validCode) return null;

  const dark = tone === "dark";

  return (
    <View style={[styles.card, dark ? styles.cardDark : styles.cardLight, style]}>
      <Text style={[styles.label, dark && styles.labelDark]}>{label}</Text>

      <View style={styles.codeRow}>
        <View style={[styles.codeBox, dark && styles.codeBoxDark]}>
          <Text
            style={[styles.codeText, dark && styles.codeTextDark]}
            selectable
            accessibilityLabel={`초대 코드 ${validCode}`}
          >
            {validCode}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.iconButton,
            dark && styles.iconButtonDark,
            pressed && styles.pressed,
            copyDisabled && styles.disabled,
          ]}
          onPress={onCopy}
          disabled={copyDisabled}
          accessibilityRole="button"
          accessibilityLabel="초대 코드 복사"
          accessibilityState={{ disabled: copyDisabled }}
        >
          {copied ? (
            <Check size={18} color={dark ? colors.ivory[50] : colors.rose[500]} />
          ) : (
            <Copy size={18} color={dark ? colors.ivory[50] : colors.rose[500]} />
          )}
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.shareButton,
          dark && styles.shareButtonDark,
          pressed && styles.pressed,
          sharing && styles.disabled,
        ]}
        onPress={handleShare}
        disabled={sharing}
        accessibilityRole="button"
        accessibilityLabel="초대 코드 공유하기"
        accessibilityHint="메신저 앱을 열어 초대 코드와 링크를 보냅니다."
        accessibilityState={{ disabled: sharing, busy: sharing }}
      >
        <Share2 size={16} color="#FFFFFF" />
        <Text style={styles.shareText}>초대 코드 보내기</Text>
      </Pressable>

      {shareUrl ? (
        <View style={styles.qrBlock}>
          {/* QR 배경은 항상 흰색이다 — 어두운 카드 위에서도 카메라가 읽어야 한다. */}
          <View style={styles.qrFrame}>
            <QRCode
              value={shareUrl}
              size={QR_SIZE}
              color={colors.noir[900]}
              backgroundColor="#FFFFFF"
              ecl="M"
            />
          </View>
          <Text style={[styles.qrHint, dark && styles.qrHintDark]}>
            파트너 폰의 기본 카메라로 이 QR을 비추면 바로 열려요.
          </Text>
        </View>
      ) : (
        <Text style={[styles.qrHint, dark && styles.qrHintDark]}>
          지금은 링크를 만들 수 없어요. 코드를 복사해 파트너에게 보내주세요.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 20,
    gap: 14,
    alignItems: "stretch",
  },
  cardLight: {
    backgroundColor: colors.ivory[100],
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDark: {
    backgroundColor: colors.noir[800],
  },
  label: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
    textAlign: "center",
  },
  labelDark: {
    color: colors.ivory[200],
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  codeBox: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.ivory[200],
  },
  codeBoxDark: {
    backgroundColor: "rgba(255, 255, 255, 0.10)",
  },
  codeText: {
    fontSize: 20,
    letterSpacing: 1.5,
    color: colors.noir[900],
    fontFamily: "CormorantGaramond_600SemiBold",
    textAlign: "center",
  },
  codeTextDark: {
    color: colors.ivory[50],
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.rose.glow,
  },
  iconButtonDark: {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: colors.rose[500],
  },
  shareButtonDark: {
    backgroundColor: colors.rose[600],
  },
  shareText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFFFFF",
  },
  qrBlock: {
    alignItems: "center",
    gap: 10,
  },
  qrFrame: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  qrHint: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
  },
  qrHintDark: {
    color: colors.ivory[200],
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
