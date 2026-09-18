import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Check, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { AppHeader, AppText, LoadingState, PrimaryButton, Surface } from "@/components/ui/AppUI";
import {
  AMORA_STYLE_COPY,
  buildAmoraStyleSections,
  createAmoraPersonalizationSession,
  viewAmoraPersonalization,
} from "@/lib/amoraPersonalizationSession.mjs";

/**
 * 아모라 도움 방식 — 웹 설정 > 아모라 도움 방식과 같은 값·문구·서버 계약.
 *
 * 저장한 값은 앱 채팅 답변에도 매 턴 들어간다. 그래서 앱에서도 직접 확인·수정·삭제할 수 있어야 한다.
 * 문구는 전부 공유 상수(칸·선택지)와 AMORA_STYLE_COPY(웹과 같은 문장)에서 온다 — 이 파일에 글자를
 * 박으면 amoraPersonalizationSettings.test.mjs 가 깨진다. 고른 값은 주소·로그 어디에도 싣지 않는다.
 */
async function readCurrentOwner(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export default function AmoraStyleScreen() {
  const [session] = useState(() =>
    createAmoraPersonalizationSession(apiFetchForExpectedUser, { readSessionOwner: readCurrentOwner }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const view = viewAmoraPersonalization(state);
  const sections = buildAmoraStyleSections(view.selected);
  const message = state.error ?? state.notice;

  useEffect(() => {
    let active = true;
    let generation = 0;
    // 소유자가 실제로 바뀌었을 때만 이전 계정의 값·초안을 비우고 새로 불러온다(커플 조건 없음).
    const apply = (ownerId: string | null) => {
      if (session.setOwner(ownerId) || ownerId === null) void session.load();
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, authSession) => {
      generation += 1;
      const ownerId = authSession?.user.id ?? null;
      // 화면 상태는 알림을 받은 즉시 비운다. 불러오기는 인증 콜백 밖에서 한다 — 콜백 안에서
      // 세션을 다시 읽으면 인증 잠금을 기다리며 멈출 수 있다.
      if (session.setOwner(ownerId) || ownerId === null) {
        setTimeout(() => {
          if (active) void session.load();
        }, 0);
      }
    });
    const requestGeneration = generation;
    void readCurrentOwner()
      .catch(() => null)
      .then((ownerId) => {
        if (active && generation === requestGeneration) apply(ownerId);
      });
    return () => {
      active = false;
      subscription.unsubscribe();
      session.dispose();
    };
  }, [session]);

  async function retry() {
    const ownerId = await readCurrentOwner().catch(() => null);
    session.setOwner(ownerId);
    await session.load();
  }

  function confirmReset() {
    if (!view.canReset) return;
    Alert.alert(AMORA_STYLE_COPY.resetTrigger, AMORA_STYLE_COPY.resetConfirmBody, [
      { text: AMORA_STYLE_COPY.resetCancel, style: "cancel" },
      { text: AMORA_STYLE_COPY.resetConfirm, style: "destructive", onPress: () => { void session.reset(); } },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <AppHeader title={AMORA_STYLE_COPY.title} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Surface tone="ivory" style={styles.introCard}>
          <View style={styles.introIcon}>
            <SlidersHorizontal size={20} color={colors.surface} />
          </View>
          <View style={styles.flex}>
            <AppText variant="eyebrow">{AMORA_STYLE_COPY.eyebrow}</AppText>
            <AppText variant="bodyStrong" style={styles.introTitle}>{AMORA_STYLE_COPY.introTitle}</AppText>
            <AppText variant="caption" style={styles.introBody}>{AMORA_STYLE_COPY.introBody}</AppText>
          </View>
        </Surface>

        {state.status === "idle" || state.status === "loading" ? (
          <View style={styles.loading}>
            <LoadingState label={AMORA_STYLE_COPY.loading} />
          </View>
        ) : null}

        {/* 불러오지 못했으면 고를 수 있는 기본값을 보이지 않는다 — 저장값을 모르는 채로 덮어쓰지 않게. */}
        {state.status === "error" ? (
          <Surface tone="rose" style={styles.errorCard}>
            <View accessibilityRole="alert" accessibilityLiveRegion="polite">
              <AppText variant="body" style={styles.errorText}>{state.error ?? AMORA_STYLE_COPY.loadFailed}</AppText>
            </View>
            <PrimaryButton tone="ghost" onPress={() => void retry()} style={styles.retryButton}>
              {AMORA_STYLE_COPY.retry}
            </PrimaryButton>
          </Surface>
        ) : null}

        {view.showChoices ? (
          <>
            <Surface tone="ivory" style={styles.statusCard}>
              <View style={styles.statusRow}>
                <ShieldCheck size={16} color={colors.sage.deep} />
                <AppText variant="bodyStrong" style={styles.flex}>{view.savedLine}</AppText>
              </View>
              <AppText variant="caption" style={styles.statusCaption}>{AMORA_STYLE_COPY.precedence}</AppText>
            </Surface>

            {sections.map((section) => (
              <Surface key={section.key} style={styles.sectionCard}>
                <AppText variant="subtitle">{section.title}</AppText>
                <AppText variant="caption" style={styles.sectionDescription}>{section.description}</AppText>
                <View style={styles.choiceList} accessibilityRole="radiogroup" accessibilityLabel={section.title}>
                  {section.choices.map((choice) => (
                    <Pressable
                      key={choice.value}
                      onPress={() => { session.select(section.key, choice.value); }}
                      disabled={!view.canSelect}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: choice.selected, disabled: !view.canSelect }}
                      style={({ pressed }) => [
                        styles.choice,
                        choice.selected && styles.choiceSelected,
                        pressed && styles.pressed,
                        !view.canSelect && styles.disabled,
                      ]}
                    >
                      <View style={styles.choiceLabelRow}>
                        {choice.selected ? <Check size={16} color={colors.rose[600]} /> : null}
                        <AppText variant="bodyStrong" style={choice.selected ? styles.choiceLabelSelected : undefined}>
                          {choice.label}
                        </AppText>
                      </View>
                      <AppText variant="caption" style={styles.choiceDescription}>{choice.description}</AppText>
                    </Pressable>
                  ))}
                </View>
              </Surface>
            ))}

            {view.showReset ? (
              <Pressable
                onPress={confirmReset}
                disabled={!view.canReset}
                accessibilityRole="button"
                style={({ pressed }) => [styles.resetButton, pressed && styles.pressed, !view.canReset && styles.disabled]}
              >
                <RotateCcw size={16} color={colors.rose[700]} />
                <AppText variant="bodyStrong" style={styles.resetText}>{AMORA_STYLE_COPY.resetTrigger}</AppText>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {view.showChoices ? (
        <View style={styles.footer}>
          {message ? (
            <View accessibilityRole={state.error ? "alert" : undefined} accessibilityLiveRegion="polite">
              <AppText variant="caption" style={state.error ? styles.errorText : styles.noticeText}>{message}</AppText>
            </View>
          ) : null}
          <PrimaryButton tone="rose" disabled={!view.canSave} onPress={() => void session.save()}>
            {view.saveLabel}
          </PrimaryButton>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing[5], paddingBottom: spacing[8], gap: spacing[4] },
  flex: { flex: 1 },
  introCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.noir[800],
  },
  introTitle: { marginTop: spacing[1] },
  introBody: { marginTop: spacing[1], color: colors.textSecondary },
  loading: { minHeight: 192 },
  errorCard: { gap: spacing[3] },
  errorText: { color: colors.dangerDeep },
  noticeText: { color: colors.sage.deep },
  retryButton: { alignSelf: "flex-start" },
  statusCard: { gap: spacing[1] },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  statusCaption: { color: colors.textSecondary },
  sectionCard: { gap: spacing[1] },
  sectionDescription: { color: colors.textSecondary },
  choiceList: { marginTop: spacing[3], gap: spacing[2] },
  choice: {
    minHeight: 56,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: 2,
  },
  choiceSelected: { borderColor: colors.rose[500], backgroundColor: colors.rose.glow },
  choiceLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  choiceLabelSelected: { color: colors.rose[700] },
  choiceDescription: { color: colors.textSecondary },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  resetButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing[2],
    paddingHorizontal: spacing[2],
  },
  resetText: { color: colors.rose[700] },
  footer: {
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
