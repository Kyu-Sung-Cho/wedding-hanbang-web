// 첫 실행 안내 — 라운지의 진짜 요소 위에 뜨는 코치마크.
//
// 왜 별도 슬라이드가 아니라 코치마크인가: 슬라이드 안내는 이미 있다(src/components/AppGuide.tsx).
// 그건 앱을 설명하고, 이건 **지금 보고 있는 화면**을 짚는다. 처음 온 사람에게 필요한 건
// 앱 소개가 아니라 "여기부터 보면 된다"는 손가락이다.
//
// 왜 못 잡은 앵커는 조용히 건너뛰는가: 화면은 사람마다 다르다(파트너와 이미 연결된 사람에겐
// 초대 코드 카드가 없다). 없는 것을 가리키느니 그 단계를 없는 것으로 두는 편이 낫다.
// 웹 엔진과 같은 규칙이다.
//
// 왜 Modal인가: 예전에는 화면 안에 StyleSheet.absoluteFill로 그렸다. 탭바는 Tabs
// 네비게이터가 화면 **밖**에 그리므로 그 스크림은 구조상 탭바를 덮을 수 없었고, "막히면
// 아모라에게"라며 FAB만 밝히는 마지막 단계에서 바로 아래 "아모라" 탭이 똑같이 밝게 남아
// 눌렸다. 그걸 눌러 라운지를 떠나면 종료 핸들러가 영영 호출되지 않아 안내도 첫마디도
// 사라졌다. Modal은 react-native 코어이고 별도 네이티브 창을 쓰므로 탭바까지 덮는다.
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  FIRST_RUN_TUTORIAL_STEPS,
  type FirstRunTutorialStep,
} from "@hanbang/shared";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import {
  buildCoachMarkPlacement,
  COACH_MARK_EDGE_MARGIN,
  type CoachMarkPlacement,
} from "@/lib/firstRunTutorial";
import {
  measureNodeInWindow,
  useFirstRunAnchorRegistry,
} from "@/components/lounge/FirstRunAnchors";

/** 안내가 어떻게 끝났는가. unavailable은 짚을 수 있는 요소가 하나도 없었다는 뜻이다. */
export type FirstRunCoachMarksOutcome = "finished" | "skipped" | "unavailable";

interface FirstRunCoachMarksProps {
  steps?: readonly FirstRunTutorialStep[];
  onClose: (outcome: FirstRunCoachMarksOutcome) => void;
}

/** 화면 아래 요소를 위로 끌어올릴 때 머리 위에 남기는 여백. */
const SCROLL_HEADROOM = 96;
/** 스크롤 애니메이션이 멈추기를 기다리는 시간. 이 뒤에 재야 엉뚱한 자리를 잰다. */
const SCROLL_SETTLE_MS = 420;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function FirstRunCoachMarks({
  steps = FIRST_RUN_TUTORIAL_STEPS,
  onClose,
}: FirstRunCoachMarksProps) {
  const registry = useFirstRunAnchorRegistry();
  const overlayRef = useRef<View>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [placement, setPlacement] = useState<CoachMarkPlacement | null>(null);
  // 실제로 사람에게 보여준 단계 수. 하나도 못 보여줬으면 완료로 기록하지 않는다 —
  // 아무것도 못 본 사람에게 "안내 봤음"을 적는 건 기록이 아니라 거짓말이다.
  const shownCountRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const step: FirstRunTutorialStep | undefined = steps[stepIndex];

  useEffect(() => {
    if (stepIndex >= steps.length) {
      onCloseRef.current(shownCountRef.current > 0 ? "finished" : "unavailable");
      return;
    }

    let cancelled = false;
    const current = steps[stepIndex];
    setPlacement(null);

    void (async () => {
      const anchor = registry.getAnchor(current.id);
      if (!anchor) {
        if (!cancelled) setStepIndex((index) => index + 1);
        return;
      }

      // 스크롤 안에 있는 요소면 먼저 보이는 자리로 끌어올린다.
      const contentOffsetY = anchor.getContentOffsetY();
      if (typeof contentOffsetY === "number" && Number.isFinite(contentOffsetY)) {
        const scrolled = registry.scrollToY(
          Math.max(contentOffsetY - SCROLL_HEADROOM, 0),
        );
        if (scrolled) {
          await delay(SCROLL_SETTLE_MS);
          if (cancelled) return;
        }
      }

      const overlay = await measureNodeInWindow(overlayRef.current);
      if (cancelled) return;
      const rect = await anchor.measure();
      if (cancelled) return;

      const next = overlay && rect ? buildCoachMarkPlacement(rect, overlay) : null;
      if (!next) {
        setStepIndex((index) => index + 1);
        return;
      }

      shownCountRef.current += 1;
      setPlacement(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [registry, stepIndex, steps]);

  const isLastStep = stepIndex >= steps.length - 1;

  function goNext() {
    setStepIndex((index) => index + 1);
  }

  function skipAll() {
    // 건너뛰기도 완료로 기록한다. 건너뛴 사람에게 매번 다시 띄우는 건 안내가 아니라 방해다.
    onCloseRef.current("skipped");
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // Android 하드웨어 뒤로가기는 Modal의 onRequestClose로 들어온다. 뒤로 나가는 것도
      // 종료로 다뤄야 프로필에 완료가 적히고 아모라의 첫마디가 만들어진다 — 안 그러면
      // 안내가 열린 채로 사람만 사라진다. 별도 BackHandler는 달지 않는다(같은 back에 두 번
      // 반응한다).
      onRequestClose={skipAll}
      // 상태바까지 덮어 모달 창의 원점을 앱 창과 맞춘다. 원점이 어긋나면 오버레이 기준으로
      // 셈한 강조 구멍이 상태바 높이만큼 밀린다.
      statusBarTranslucent
    >
      <View
        ref={overlayRef}
        style={styles.overlay}
        collapsable={false}
        accessibilityViewIsModal
      >
        {placement && step ? (
          <>
            {/* 어둡게 덮는 네 조각. 가운데는 비워서 진짜 요소가 그대로 보인다. */}
            <View
              style={[
                styles.scrim,
                { left: 0, right: 0, top: 0, height: placement.hole.top },
              ]}
            />
            <View
              style={[
                styles.scrim,
                {
                  left: 0,
                  right: 0,
                  top: placement.hole.top + placement.hole.height,
                  bottom: 0,
                },
              ]}
            />
            <View
              style={[
                styles.scrim,
                {
                  left: 0,
                  width: placement.hole.left,
                  top: placement.hole.top,
                  height: placement.hole.height,
                },
              ]}
            />
            <View
              style={[
                styles.scrim,
                {
                  left: placement.hole.left + placement.hole.width,
                  right: 0,
                  top: placement.hole.top,
                  height: placement.hole.height,
                },
              ]}
            />

            {/* 구멍 위를 덮는 투명 버튼. 안내 중에 실수로 밑을 눌러 화면이 바뀌는 것을 막고,
                짚어준 곳을 눌러 다음으로 넘어갈 수 있게 한다. */}
            <Pressable
              style={[
                styles.hole,
                {
                  left: placement.hole.left,
                  top: placement.hole.top,
                  width: placement.hole.width,
                  height: placement.hole.height,
                },
              ]}
              onPress={goNext}
              accessibilityRole="button"
              accessibilityLabel={step.title + ". 다음으로"}
            />

            <View
              style={[
                styles.tooltip,
                placement.tooltipTop !== null
                  ? { top: placement.tooltipTop }
                  : { bottom: placement.tooltipBottom ?? COACH_MARK_EDGE_MARGIN },
              ]}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.tooltipTitle}>{step.title}</Text>
              <Text style={styles.tooltipBody}>{step.body}</Text>
              <View style={styles.tooltipActions}>
                <Pressable
                  style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
                  onPress={skipAll}
                  accessibilityRole="button"
                  accessibilityLabel="안내 건너뛰기"
                >
                  <Text style={styles.skipText}>건너뛰기</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
                  onPress={goNext}
                  accessibilityRole="button"
                  accessibilityLabel={isLastStep ? "안내 마치기" : "다음 안내 보기"}
                >
                  <Text style={styles.nextText}>{isLastStep ? "시작하기" : "다음"}</Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : (
          // 자리를 재는 동안에도 화면은 덮어 둔다. 반쯤 열린 안내 사이로 화면을 누르면
          // 안내가 가리키던 곳이 사라진다.
          <View style={[styles.scrim, StyleSheet.absoluteFillObject]} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  scrim: {
    position: "absolute",
    backgroundColor: "rgba(24, 20, 20, 0.66)",
  },
  hole: {
    position: "absolute",
    borderRadius: radius["2xl"],
    borderWidth: 2,
    borderColor: colors.rose.light,
  },
  tooltip: {
    position: "absolute",
    left: COACH_MARK_EDGE_MARGIN,
    right: COACH_MARK_EDGE_MARGIN,
    padding: spacing[5],
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  tooltipTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  tooltipBody: {
    marginTop: spacing[2],
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  tooltipActions: {
    marginTop: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  skipButton: {
    minHeight: 44,
    paddingHorizontal: spacing[2],
    justifyContent: "center",
  },
  skipText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
  },
  nextButton: {
    minHeight: 44,
    paddingHorizontal: spacing[5],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.noir[800],
  },
  nextText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.surface,
  },
  pressed: {
    opacity: 0.78,
  },
});
