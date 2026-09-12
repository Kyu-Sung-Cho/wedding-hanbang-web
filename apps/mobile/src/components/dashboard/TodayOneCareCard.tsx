import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { router, useFocusEffect } from "expo-router";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import {
  validateTodayOneCareResponse,
  type TodayOneCareAction,
  type TodayOneCareCard as TodayOneCareCardData,
  type TodayOneCareResponse,
} from "@hanbang/shared";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  buildTodayOneActionBody,
  getTodayOneNativeRoute,
  parseTodayOneEnvelope,
} from "@/lib/todayOneCare.mjs";
import { PrimaryButton, appShadow } from "@/components/ui/AppUI";

type ReadyResult = TodayOneCareResponse & { card: TodayOneCareCardData };
type ViewState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; result: ReadyResult }
  | { kind: "empty"; message: string }
  | { kind: "paused"; message: string }
  | { kind: "stale"; message: string }
  | { kind: "error"; message: string };

interface RawResponse {
  ok: boolean;
  payload: unknown;
}

const ACTION_LABELS: Record<Exclude<TodayOneCareAction, "open_source">, string> = {
  snooze: "나중에",
  dismiss: "오늘 숨기기",
  mute_source: "내용이 바뀔 때까지 숨기기",
};

const ACTION_SUCCESS: Record<Exclude<TodayOneCareAction, "open_source">, string> = {
  snooze: "확인했어요. 잠시 후 다시 보여드릴게요.",
  dismiss: "오늘은 숨겼어요.",
  mute_source: "현재 내용은 숨겼어요. 내용이 달라지면 다시 보여드려요.",
};

function viewFromResponse(
  raw: RawResponse,
  userId: string,
  successMessage?: string,
): ViewState {
  const envelope = parseTodayOneEnvelope(raw.payload);
  if (!envelope) {
    return { kind: "error", message: "오늘 확인할 내용의 응답을 확인하지 못했어요." };
  }
  if (!envelope.available) return { kind: "unavailable" };

  const validation = validateTodayOneCareResponse(envelope.result, userId);
  if (!validation.ok) {
    return { kind: "error", message: "오늘 확인할 내용의 소유자와 형식을 확인하지 못했어요." };
  }
  const result = validation.value;
  if (result.state === "source_stale") {
    return {
      kind: "stale",
      message: envelope.error ?? "기록이 바뀌었어요. 최신 내용을 다시 불러와 확인해 주세요.",
    };
  }
  if (!raw.ok) {
    return {
      kind: "error",
      message: envelope.error ?? "오늘 확인할 내용을 불러오지 못했어요.",
    };
  }
  if (result.state === "ready" && result.card) {
    return { kind: "ready", result: result as ReadyResult };
  }
  if (result.state === "paused") {
    return {
      kind: "paused",
      message: successMessage ?? "오늘의 한 가지는 잠시 쉬고 있어요.",
    };
  }
  if (result.state === "disabled") return { kind: "unavailable" };
  return {
    kind: "empty",
    message: successMessage
      ?? (result.state === "daily_limit"
        ? "오늘의 한 가지는 이미 확인했어요."
        : "오늘 새로 확인할 내용은 없어요."),
  };
}

function formatClaimedDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

async function readRawResponse(
  expectedUserId: string,
  path: string,
  options: RequestInit = {},
): Promise<RawResponse> {
  const response = await apiFetchForExpectedUser(expectedUserId, path, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });
  return {
    ok: response.ok,
    payload: await response.json().catch(() => null),
  };
}

export default function TodayOneCareCard({
  refreshVersion = 0,
}: {
  refreshVersion?: number;
}) {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [authGeneration, setAuthGeneration] = useState(0);
  const [pendingAction, setPendingAction] = useState<TodayOneCareAction | null>(null);
  const [actionError, setActionError] = useState("");
  const loadGeneration = useRef(0);
  const actionGeneration = useRef(0);
  const inFlightAction = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const sessionUserId = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (inFlightAction.current) return;
    const operation = ++loadGeneration.current;
    setView({ kind: "loading" });
    setActionError("");
    try {
      const userId = await currentVerifiedUserId();
      sessionUserId.current = userId;
      if (!userId) {
        if (operation === loadGeneration.current) setView({ kind: "unavailable" });
        return;
      }
      const raw = await readRawResponse(userId, "/api/amora/today-one", {
        method: "GET",
        signal,
      });
      const userIdAfterResponse = await currentVerifiedUserId();
      if (
        operation !== loadGeneration.current
        || userIdAfterResponse !== userId
      ) {
        return;
      }
      setView(viewFromResponse(raw, userId));
    } catch (error) {
      if (
        operation === loadGeneration.current
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        setView({ kind: "error", message: "오늘 확인할 내용을 불러오지 못했어요." });
      }
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === sessionUserId.current) return;
      sessionUserId.current = nextUserId;
      loadGeneration.current += 1;
      actionGeneration.current += 1;
      loadController.current?.abort();
      loadController.current = null;
      actionController.current?.abort();
      actionController.current = null;
      inFlightAction.current = false;
      setPendingAction(null);
      setActionError("");
      setView(nextUserId ? { kind: "loading" } : { kind: "unavailable" });
      setAuthGeneration((generation) => generation + 1);
    });
    return () => subscription.unsubscribe();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadController.current = controller;
      void load(controller.signal);
      return () => {
        controller.abort();
        if (loadController.current === controller) loadController.current = null;
        loadGeneration.current += 1;
        actionGeneration.current += 1;
        actionController.current?.abort();
        actionController.current = null;
        inFlightAction.current = false;
        setPendingAction(null);
      };
    }, [authGeneration, load, refreshVersion]),
  );

  async function actOnCard(action: TodayOneCareAction) {
    if (view.kind !== "ready" || pendingAction || inFlightAction.current) return;
    inFlightAction.current = true;
    loadGeneration.current += 1;
    loadController.current?.abort();
    loadController.current = null;
    const card = view.result.card;
    const userId = view.result.recipientUserId;
    const body = buildTodayOneActionBody(
      { id: card.id, revision: card.revision, sourceRevision: card.sourceRevision },
      action,
    );
    if (!body) {
      inFlightAction.current = false;
      setActionError("카드의 최신 상태를 확인하지 못했어요. 다시 불러와 주세요.");
      return;
    }

    const operation = ++actionGeneration.current;
    const controller = new AbortController();
    actionController.current = controller;
    setPendingAction(action);
    setActionError("");
    try {
      if (await currentVerifiedUserId() !== userId) {
        setView({ kind: "unavailable" });
        return;
      }
      const raw = await readRawResponse(userId, "/api/amora/today-one", {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (
        operation !== actionGeneration.current
        || await currentVerifiedUserId() !== userId
      ) {
        return;
      }

      const next = viewFromResponse(
        raw,
        userId,
        action === "open_source" ? undefined : ACTION_SUCCESS[action],
      );
      if (next.kind === "stale") {
        setView(next);
        return;
      }
      if (next.kind === "error" || next.kind === "unavailable") {
        setActionError(
          next.kind === "error"
            ? next.message
            : "기능 상태가 바뀌었어요. 다시 불러와 주세요.",
        );
        return;
      }
      if (action === "open_source") {
        if (next.kind !== "empty" && next.kind !== "paused") {
          setActionError("기록 열기 상태를 확인하지 못했어요. 다시 불러와 주세요.");
          return;
        }
        const destination = getTodayOneNativeRoute(card.nextAction.href);
        if (!destination) {
          setActionError("안전하게 열 수 있는 화면인지 확인하지 못했어요.");
          return;
        }
        router.push(destination);
        return;
      }
      setView(next);
    } catch {
      if (operation === actionGeneration.current) {
        setActionError("선택을 저장하지 못했어요. 카드에는 아무것도 바뀌지 않았어요.");
      }
    } finally {
      if (operation === actionGeneration.current) {
        actionController.current = null;
        inFlightAction.current = false;
        setPendingAction(null);
      }
    }
  }

  if (view.kind === "unavailable" || view.kind === "loading") return null;

  if (view.kind === "error" || view.kind === "stale") {
    return (
      <View style={styles.statusCard} accessibilityRole="alert">
        <View style={styles.statusIcon}>
          <RotateCcw size={18} color={colors.rose[600]} />
        </View>
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>오늘의 한 가지를 다시 확인해 주세요</Text>
          <Text style={styles.statusDescription}>{view.message}</Text>
          <Pressable
            onPress={() => void load()}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>다시 불러오기</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (view.kind === "empty" || view.kind === "paused") {
    return (
      <View style={styles.statusCard} accessibilityRole="summary">
        <View style={styles.statusIcon}>
          {view.kind === "paused" ? (
            <Clock3 size={18} color={colors.rose[600]} />
          ) : (
            <CheckCircle2 size={18} color={colors.sage[500]} />
          )}
        </View>
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>아모라 오늘의 한 가지</Text>
          <Text style={styles.statusDescription}>{view.message}</Text>
        </View>
      </View>
    );
  }

  const card = view.result.card;
  const isBudget = card.kind === "budget_guardrail";
  const ConfirmedIcon = isBudget ? WalletCards : CalendarClock;
  const recordLabel = isBudget ? "예산" : "일정";
  const actions = new Set(card.choices.map((choice) => choice.action));

  return (
    <View style={styles.card} accessibilityLabel="아모라 오늘의 한 가지">
      <View style={styles.cardHeader}>
        <View style={styles.headerMeta}>
          <View style={styles.headerLabel}>
            <Sparkles size={15} color={colors.ivory[100]} />
            <Text style={styles.eyebrow}>아모라 오늘의 한 가지 · 인앱</Text>
          </View>
          <View style={styles.headerLabel}>
            <ShieldCheck size={14} color={colors.sage.pale} />
            <Text style={styles.externalLabel}>외부 알림 아님</Text>
          </View>
        </View>
        <Text style={styles.headerTitle}>왜 지금 보여드리나요</Text>
        <Text style={styles.whyNow}>{card.whyNow}</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.versionText}>
          {formatClaimedDate(view.result.claimedForDate)} 기준 · 현재 {recordLabel} 기록 {card.sourceRevision} · 확인 전
        </Text>

        <View style={styles.block}>
          <Text style={styles.blockLabel}>현재 저장된 {recordLabel}에서 확인됨</Text>
          {card.confirmed.map((item) => (
            <View key={item} style={styles.factRow}>
              <ConfirmedIcon size={16} color={colors.sage[500]} />
              <Text style={styles.factText}>{item}</Text>
            </View>
          ))}
        </View>

        {card.unknown.length > 0 ? (
          <View style={[styles.block, styles.unknownBlock]}>
            <Text style={styles.blockLabel}>아직 확인되지 않은 점</Text>
            {card.unknown.map((item) => (
              <Text key={item} style={styles.unknownText}>· {item}</Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.impact}>{card.impact}</Text>

        {actionError ? (
          <Text style={styles.errorText} accessibilityRole="alert">{actionError}</Text>
        ) : null}
        {pendingAction ? (
          <View style={styles.pendingRow} accessibilityRole="progressbar">
            <ActivityIndicator size="small" color={colors.sage[500]} />
            <Text style={styles.pendingText}>
              선택을 확인하고 있어요. 확인 전에는 카드를 바꾸지 않아요.
            </Text>
          </View>
        ) : null}

        {actions.has("open_source") ? (
          <PrimaryButton
            tone="rose"
            onPress={() => void actOnCard("open_source")}
            disabled={pendingAction !== null}
          >
            {card.nextAction.label}
          </PrimaryButton>
        ) : null}
        <View style={styles.secondaryActions}>
          {(["snooze", "dismiss", "mute_source"] as const).map((action) =>
            actions.has(action) ? (
              <Pressable
                key={action}
                onPress={() => void actOnCard(action)}
                disabled={pendingAction !== null}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  pendingAction !== null && styles.disabled,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>{ACTION_LABELS[action]}</Text>
              </Pressable>
            ) : null,
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.sage.pale,
    backgroundColor: colors.surface,
    ...appShadow,
  },
  cardHeader: {
    padding: spacing[5],
    backgroundColor: colors.noir[800],
    gap: spacing[2],
  },
  headerMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  headerLabel: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  eyebrow: { fontSize: 11, fontWeight: "600", color: colors.ivory[100] },
  externalLabel: { fontSize: 11, color: colors.sage.pale },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", marginTop: spacing[1] },
  whyNow: { fontSize: 14, lineHeight: 22, color: colors.ivory[100] },
  body: { padding: spacing[5], gap: spacing[4] },
  versionText: { fontSize: 11, lineHeight: 18, color: colors.textTertiary },
  block: { gap: spacing[2] },
  blockLabel: { fontSize: 12, fontWeight: "600", color: colors.rose[600] },
  factRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  factText: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.noir[800] },
  unknownBlock: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing[4] },
  unknownText: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  impact: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.ivory[100],
    color: colors.noir[800],
    fontSize: 12,
    lineHeight: 19,
  },
  errorText: { fontSize: 13, lineHeight: 20, color: colors.danger },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  pendingText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.sage[500] },
  secondaryActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  secondaryButton: {
    minHeight: 42,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing[4],
    backgroundColor: colors.surface,
  },
  secondaryText: { fontSize: 13, fontWeight: "600", color: colors.noir[800] },
  pressed: { opacity: 0.74 },
  disabled: { opacity: 0.5 },
  statusCard: {
    flexDirection: "row",
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing[4],
    backgroundColor: colors.ivory[100],
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  statusCopy: { flex: 1, gap: spacing[1] },
  statusTitle: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  statusDescription: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  retryButton: { alignSelf: "flex-start", paddingVertical: spacing[2] },
  retryText: { fontSize: 13, fontWeight: "600", color: colors.rose[600] },
});
