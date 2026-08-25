// 웨딩 라운지 우하단 아모라 버튼.
//
// 왜 탭이 있는데 버튼을 또 두는가: 탭은 "지금 아모라 화면으로 간다"는 이동 수단이고,
// 이 버튼은 아모라가 **먼저 말을 걸 자리**다. 말풍선이 붙을 곳이 없으면 아모라는 사람이
// 먼저 찾아올 때까지 아무 말도 못 한다.
//
// 위치: 탭바는 레이아웃 공간을 차지하므로 이 버튼이 사는 화면 컨테이너의 bottom은 이미
// 탭바 위다. 그래서 셈에 탭바 높이나 인셋을 더하지 않는다 — 그 셈은
// `src/lib/firstRunTutorial.ts`의 getAmoraFabBottomOffset이 소유하고, 전제(탭바가 static)가
// 깨지지 않는지는 테스트가 `app/(tabs)/_layout.tsx`에서 확인한다.
//
// 말풍선도 버튼이다: 웹은 같은 말풍선을 눌러 대화가 열린다. 앱에서만 읽기 전용이면
// 아모라가 먼저 건넨 말을 눌러본 사람은 아무 일도 일어나지 않는 화면을 만난다.
import { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Sparkles, X } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import { AMORA_FAB_SIZE, getAmoraFabBottomOffset } from "@/lib/firstRunTutorial";
import { FirstRunAnchor } from "@/components/lounge/FirstRunAnchors";

export interface AmoraFabProps {
  /** 버튼을 눌렀을 때. 보통 아모라 대화 화면으로 보낸다. */
  onPress: () => void;
  /** 말풍선 한 줄. 없으면 말풍선을 그리지 않는다. */
  bubbleText?: string | null;
  /** 아직 읽지 않은 첫마디가 있는가. 버튼 위 점으로 보인다. */
  unread?: boolean;
  /** 말풍선 닫기. 없으면 닫기 버튼을 그리지 않는다. */
  onDismissBubble?: () => void;
  /** 첫 실행 안내가 이 버튼을 가리킬 때 쓰는 앵커 id. */
  anchorId?: string;
}

export default function AmoraFab({
  onPress,
  bubbleText,
  unread = false,
  onDismissBubble,
  anchorId = "amora-fab",
}: AmoraFabProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const bubble = typeof bubbleText === "string" && bubbleText.trim().length > 0
    ? bubbleText.trim()
    : null;

  return (
    <FirstRunAnchor
      id={anchorId}
      pointerEvents="box-none"
      style={[styles.root, { bottom: getAmoraFabBottomOffset() }]}
    >
      {bubble ? (
        // 닫기 버튼을 말풍선 **밖**에 둔다.
        //
        // 안에 두면 바깥 Pressable 이 `accessibilityRole="button"` 과 라벨을 갖고
        // 있어서 하나의 접근성 요소가 되고, **스크린리더에서는 자식 버튼이 삼켜져
        // 누를 수 없다.** 이 저장소는 같은 방식으로 승인 버튼을 한 번 잃은 적이 있다.
        // `bubbleClose` 는 이미 절대 위치라 형제로 옮겨도 자리가 그대로다.
        <View style={styles.bubbleWrap}>
          <Pressable
            style={({ pressed }) => [styles.bubble, pressed && styles.bubblePressed]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`아모라: ${bubble}`}
            accessibilityHint="눌러서 아모라와의 대화를 열어요"
          >
            <Text style={styles.bubbleText} numberOfLines={3}>
              {bubble}
            </Text>
            <View style={styles.bubbleTail} />
          </Pressable>
          {onDismissBubble ? (
            <Pressable
              style={({ pressed }) => [styles.bubbleClose, pressed && styles.pressed]}
              onPress={onDismissBubble}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="아모라 알림 닫기"
            >
              <X size={14} color={colors.taupe[500]} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Animated.View style={[styles.buttonWrap, { transform: [{ scale }] }]}>
        <Pressable
          style={styles.button}
          onPress={onPress}
          onPressIn={() => {
            Animated.spring(scale, { toValue: 0.92, useNativeDriver: true }).start();
          }}
          onPressOut={() => {
            Animated.spring(scale, {
              toValue: 1,
              friction: 3,
              useNativeDriver: true,
            }).start();
          }}
          accessibilityRole="button"
          accessibilityLabel="아모라와 대화하기"
          accessibilityHint={
            bubble
              ? "아모라가 먼저 건넨 말이 대화에 놓여 있어요"
              : "결혼 준비 이야기를 아모라와 이어가요"
          }
        >
          <Sparkles size={24} color={colors.gold.light} />
        </Pressable>
        {unread ? <View style={styles.unreadDot} accessibilityElementsHidden /> : null}
      </Animated.View>
    </FirstRunAnchor>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    right: 18,
    alignItems: "flex-end",
  },
  // 말풍선과 닫기 버튼을 담는 자리. 닫기가 말풍선 밖으로 나오면서 필요해졌고,
  // 바깥 여백은 여기가 진다(말풍선 자신은 안쪽 여백만 갖는다).
  bubbleWrap: {
    maxWidth: 250,
    marginBottom: spacing[3],
    marginRight: 6,
  },
  bubble: {
    maxWidth: 250,
    paddingVertical: spacing[3],
    paddingLeft: spacing[4],
    paddingRight: spacing[5],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 8,
  },
  bubbleText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  bubblePressed: {
    opacity: 0.88,
  },
  bubbleClose: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  // 말풍선이 버튼에서 나온 것처럼 보이게 하는 작은 꼬리.
  bubbleTail: {
    position: "absolute",
    right: 22,
    bottom: -5,
    width: 10,
    height: 10,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    transform: [{ rotate: "45deg" }],
  },
  buttonWrap: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  button: {
    width: AMORA_FAB_SIZE,
    height: AMORA_FAB_SIZE,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.noir[800],
  },
  unreadDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.rose[500],
  },
  pressed: {
    opacity: 0.6,
  },
});
