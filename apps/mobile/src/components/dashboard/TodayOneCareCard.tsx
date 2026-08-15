import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
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
  TODAY_ONE_CARE_CONTRACT_VERSION,
  TODAY_ONE_CARE_CONTRACT_VERSION_HEADER,
  validateCompatibleTodayOneCareResponse,
  type TodayOneCareAction,
  type TodayOneCareCard as TodayOneCareCardData,
  type TodayOneCareResponse,
} from "@hanbang/shared";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  buildTodayOneActionBody,
  canRenderTodayOneFallback,
  getTodayOneNativeKindPresentation,
  getTodayOneNativeRoute,
  isTodayOneCareCardCurrent,
  parseTodayOneEnvelope,
} from "@/lib/todayOneCare.mjs";
import { stagePrivateChatHandoff } from "@/lib/companionChatHandoff.mjs";
import {
  buildScheduleCareFollowUpBinding,
  buildScheduleCarePrivateFollowUpPrompt,
  loadScheduleCareFollowUpPreview,
  verifyScheduleCarePrivateFollowUpIdentity,
} from "@/lib/scheduleCarePrivateFollowUp.mjs";
import { PrimaryButton, appShadow } from "@/components/ui/AppUI";
import AmoraPersonalizationSheet from "@/components/chat/AmoraPersonalizationSheet";
import { canOfferFamilyMomentPersonalization } from "@/lib/amoraPersonalization.mjs";

type ReadyResult = TodayOneCareResponse & { card: TodayOneCareCardData };
type ViewState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "fallback" }
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

const CONFIRMED_ICONS = {
  schedule: CalendarClock,
  budget: WalletCards,
  decision: CheckCircle2,
} as const;

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

  const validation = validateCompatibleTodayOneCareResponse(envelope.result, userId);
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
  if (
    result.state === "ready"
    && result.card
    && !isTodayOneCareCardCurrent(result.card, Date.now())
  ) {
    return { kind: "fallback" };
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
  if (result.state === "none") return { kind: "fallback" };
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

async function currentVerifiedIdentity(): Promise<{
  userId: string;
  coupleId: string;
} | null> {
  const userId = await currentVerifiedUserId();
  if (!userId) return null;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || typeof profile?.couple_id !== "string") return null;
  if (await currentVerifiedUserId() !== userId) return null;
  return { userId, coupleId: profile.couple_id };
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
  fallback = null,
  expectedOwnerUserId = null,
  expectedCoupleId = null,
}: {
  refreshVersion?: number;
  fallback?: ReactNode;
  expectedOwnerUserId?: string | null;
  expectedCoupleId?: string | null;
}) {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [authGeneration, setAuthGeneration] = useState(0);
  const [pendingAction, setPendingAction] = useState<TodayOneCareAction | null>(null);
  const [actionError, setActionError] = useState("");
  const [careExpanded, setCareExpanded] = useState(false);
  const [privateFollowUpPending, setPrivateFollowUpPending] = useState(false);
  const [familyPersonalizationVisible, setFamilyPersonalizationVisible] = useState(false);
  const [familyPersonalizationPending, setFamilyPersonalizationPending] = useState(false);
  const [verifiedSessionUserId, setVerifiedSessionUserId] = useState<string | null>(null);
  const [verifiedSessionCoupleId, setVerifiedSessionCoupleId] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const actionGeneration = useRef(0);
  const inFlightAction = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const sessionUserId = useRef<string | null>(null);
  const readyCardId = view.kind === "ready" ? view.result.card.id : null;

  useEffect(() => {
    setCareExpanded(false);
    setPrivateFollowUpPending(false);
    setFamilyPersonalizationVisible(false);
    setFamilyPersonalizationPending(false);
  }, [readyCardId]);

  useEffect(() => {
    setFamilyPersonalizationVisible(false);
    setFamilyPersonalizationPending(false);
  }, [expectedCoupleId, expectedOwnerUserId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (inFlightAction.current) return;
    const operation = ++loadGeneration.current;
    setView({ kind: "loading" });
    setActionError("");
    try {
      const identity = await currentVerifiedIdentity();
      if (operation !== loadGeneration.current) return;
      const userId = identity?.userId ?? null;
      sessionUserId.current = userId;
      setVerifiedSessionUserId(userId);
      setVerifiedSessionCoupleId(identity?.coupleId ?? null);
      if (
        !identity
        || !canRenderTodayOneFallback(
          expectedOwnerUserId,
          identity.userId,
          expectedCoupleId,
          identity.coupleId,
        )
      ) {
        setView({ kind: "unavailable" });
        return;
      }
      const raw = await readRawResponse(identity.userId, "/api/amora/today-one", {
        method: "GET",
        headers: {
          [TODAY_ONE_CARE_CONTRACT_VERSION_HEADER]: String(TODAY_ONE_CARE_CONTRACT_VERSION),
        },
        signal,
      });
      const identityAfterResponse = await currentVerifiedIdentity();
      if (
        operation !== loadGeneration.current
        || identityAfterResponse?.userId !== identity.userId
        || identityAfterResponse?.coupleId !== identity.coupleId
      ) {
        return;
      }
      setView(viewFromResponse(raw, identity.userId));
    } catch (error) {
      if (
        operation === loadGeneration.current
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        setView({ kind: "error", message: "오늘 확인할 내용을 불러오지 못했어요." });
      }
    }
  }, [expectedCoupleId, expectedOwnerUserId]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === sessionUserId.current) return;
      sessionUserId.current = nextUserId;
      setVerifiedSessionUserId(nextUserId);
      setVerifiedSessionCoupleId(null);
      loadGeneration.current += 1;
      actionGeneration.current += 1;
      loadController.current?.abort();
      loadController.current = null;
      actionController.current?.abort();
      actionController.current = null;
      inFlightAction.current = false;
      setPendingAction(null);
      setPrivateFollowUpPending(false);
      setFamilyPersonalizationVisible(false);
      setFamilyPersonalizationPending(false);
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
        setPrivateFollowUpPending(false);
        setFamilyPersonalizationVisible(false);
        setFamilyPersonalizationPending(false);
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
    const destination = action === "open_source"
      ? getTodayOneNativeRoute(card.nextAction.href)
      : null;
    if (action === "open_source" && !destination) {
      inFlightAction.current = false;
      setActionError("안전하게 열 수 있는 화면인지 확인하지 못했어요.");
      return;
    }
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
        headers: {
          [TODAY_ONE_CARE_CONTRACT_VERSION_HEADER]: String(TODAY_ONE_CARE_CONTRACT_VERSION),
        },
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

  async function openPrivateScheduleFollowUp() {
    if (
      view.kind !== "ready"
      || pendingAction
      || privateFollowUpPending
      || inFlightAction.current
    ) return;

    const card = view.result.card;
    const prompt = buildScheduleCarePrivateFollowUpPrompt(card);
    const sourceBinding = buildScheduleCareFollowUpBinding(card);
    const requiresSourceBoundSanggyeonrye = card.kind === "schedule_moment"
      && card.care?.attentionWindow === "dAfter"
      && card.care.momentType === "sanggyeonrye";
    if (!prompt) return;
    if (requiresSourceBoundSanggyeonrye && !sourceBinding) {
      setActionError("상견례 일정의 최신 출처를 확인하지 못해 비공개 대화를 열지 않았어요. 카드를 다시 불러와 주세요.");
      return;
    }

    inFlightAction.current = true;
    loadGeneration.current += 1;
    loadController.current?.abort();
    loadController.current = null;
    const operation = ++actionGeneration.current;
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    setPrivateFollowUpPending(true);
    setActionError("");

    try {
      const verifiedUserIdBeforeProfile = await currentVerifiedUserId();
      if (operation !== actionGeneration.current) return;
      if (!verifiedUserIdBeforeProfile) {
        setActionError("현재 계정과 연결 상태를 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", verifiedUserIdBeforeProfile)
        .maybeSingle();
      if (operation !== actionGeneration.current) return;
      if (profileError) {
        setActionError("커플 연결 상태를 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.");
        return;
      }

      const verifiedUserIdAfterProfile = await currentVerifiedUserId();
      if (operation !== actionGeneration.current) return;
      const identity = verifyScheduleCarePrivateFollowUpIdentity({
        expectedOwnerUserId,
        recipientUserId: view.result.recipientUserId,
        expectedCoupleId,
        verifiedOwnerUserId: verifiedUserIdAfterProfile,
        verifiedCoupleId: profile?.couple_id ?? null,
      });
      if (!identity) {
        setActionError("계정 또는 커플 연결 상태가 바뀌었어요. 잘못 이어지지 않도록 비공개 대화를 열지 않았어요.");
        return;
      }

      if (sourceBinding) {
        const preview = await loadScheduleCareFollowUpPreview({
          expectedOwnerUserId: identity.ownerUserId,
          expectedCoupleId: identity.coupleId,
          binding: sourceBinding,
          fetchForExpectedUser: apiFetchForExpectedUser,
          signal: controller.signal,
        });
        if (operation !== actionGeneration.current || controller.signal.aborted) return;
        const identityAfterPreview = await currentVerifiedIdentity();
        if (operation !== actionGeneration.current || controller.signal.aborted) return;
        if (
          preview.status !== "ready"
          || identityAfterPreview?.userId !== preview.ownerUserId
          || identityAfterPreview?.coupleId !== preview.coupleId
        ) {
          setActionError(
            preview.status === "timeout"
              ? "확인이 조금 오래 걸렸어요. 아무것도 보내거나 저장하지 않았어요. 다시 시도해 주세요."
              : preview.status === "stale"
                ? "일정 기록이 바뀌었어요. 최신 오늘의 한 가지를 다시 불러와 주세요."
                : preview.status === "identity_changed"
                  ? "계정 또는 커플 연결 상태가 바뀌었어요. 현재 상태를 다시 불러와 주세요."
                  : "최신 일정 상태를 확인하지 못했어요. 아무것도 보내거나 저장하지 않았어요.",
          );
          return;
        }
        const companionHandoff = stagePrivateChatHandoff({
          handoffId: Crypto.randomUUID(),
          ownerUserId: preview.ownerUserId,
          coupleId: preview.coupleId,
          prompt: preview.prompt,
          scheduleCareFollowUp: preview.binding,
        });
        if (!companionHandoff) {
          setActionError("비공개 대화 초안을 안전하게 준비하지 못했어요. 다시 시도해 주세요.");
          return;
        }
        router.push({
          pathname: "/(tabs)/chat",
          params: {
            companionHandoff,
            scheduleCareCardId: preview.binding.cardId,
            scheduleCareCardRevision: String(preview.binding.cardRevision),
            scheduleCareSourceRevision: String(preview.binding.sourceRevision),
          },
        });
        return;
      }

      const companionHandoff = stagePrivateChatHandoff({
        handoffId: Crypto.randomUUID(),
        ownerUserId: identity.ownerUserId,
        coupleId: identity.coupleId,
        prompt,
      });
      if (!companionHandoff) {
        setActionError("비공개 대화 초안을 안전하게 준비하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      router.push({
        pathname: "/(tabs)/chat",
        params: { companionHandoff },
      });
    } catch {
      if (operation === actionGeneration.current) {
        setActionError("연결 상태를 확인하지 못해 비공개 대화를 열지 않았어요. 연결을 확인한 뒤 다시 시도해 주세요.");
      }
    } finally {
      if (operation === actionGeneration.current) {
        inFlightAction.current = false;
        setPrivateFollowUpPending(false);
      }
      if (actionController.current === controller) actionController.current = null;
    }
  }

  const canRenderFallback = canRenderTodayOneFallback(
    expectedOwnerUserId,
    verifiedSessionUserId,
    expectedCoupleId,
    verifiedSessionCoupleId,
  );
  if (
    view.kind === "unavailable"
    || view.kind === "loading"
    || view.kind === "fallback"
  ) return canRenderFallback ? fallback : null;

  if (view.kind === "error" || view.kind === "stale") {
    return (
      <View style={styles.recoveryStack}>
        {canRenderFallback ? fallback : null}
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
  const kindPresentation = getTodayOneNativeKindPresentation(card.kind);
  const ConfirmedIcon = CONFIRMED_ICONS[kindPresentation.icon];
  const { recordLabel } = kindPresentation;
  const actions = new Set(card.choices.map((choice) => choice.action));
  const care = card.kind === "schedule_moment" ? card.care : undefined;
  const relatedBudget = care?.relatedBudget;
  const familyMomentContext = care
    && (care.momentType === "sanggyeonrye" || care.momentType === "family_greeting")
    && (care.attentionWindow === "d3" || care.attentionWindow === "d1")
    && canOfferFamilyMomentPersonalization(care.momentType, care.attentionWindow)
    ? {
        momentType: care.momentType,
        attentionWindow: care.attentionWindow,
      } as const
    : null;
  const privateFollowUpPrompt = care?.question
    ? buildScheduleCarePrivateFollowUpPrompt(card)
    : null;
  const expectedPrivateIdentity = privateFollowUpPrompt
    ? verifyScheduleCarePrivateFollowUpIdentity({
        expectedOwnerUserId,
        recipientUserId: view.result.recipientUserId,
        expectedCoupleId,
        verifiedOwnerUserId: expectedOwnerUserId,
        verifiedCoupleId: expectedCoupleId,
      })
    : null;

  async function openFamilyMomentPersonalization() {
    if (
      view.kind !== "ready"
      || !familyMomentContext
      || pendingAction
      || familyPersonalizationPending
      || inFlightAction.current
    ) return;

    inFlightAction.current = true;
    const operation = ++actionGeneration.current;
    setFamilyPersonalizationPending(true);
    setActionError("");
    try {
      const identity = await currentVerifiedIdentity();
      if (operation !== actionGeneration.current) return;
      if (
        !canRenderTodayOneFallback(
          expectedOwnerUserId,
          identity?.userId ?? null,
          expectedCoupleId,
          identity?.coupleId ?? null,
        )
        || identity?.userId !== view.result.recipientUserId
      ) {
        setActionError("계정 또는 커플 연결 상태가 바뀌어 가족 조율 설정을 열지 않았어요.");
        return;
      }
      setFamilyPersonalizationVisible(true);
    } catch {
      if (operation === actionGeneration.current) {
        setActionError("연결 상태를 확인하지 못해 가족 조율 설정을 열지 않았어요.");
      }
    } finally {
      if (operation === actionGeneration.current) {
        inFlightAction.current = false;
        setFamilyPersonalizationPending(false);
      }
    }
  }

  return (
    <>
    <View style={styles.card} accessibilityLabel="아모라 오늘의 한 가지">
      <View style={styles.cardHeader}>
        <View style={styles.headerMeta}>
          <View style={styles.headerLabel}>
            <Sparkles size={15} color={colors.ivory[100]} />
            <Text style={styles.eyebrow}>AMORA · AI 결혼 준비 동반자</Text>
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

        {care ? (
          <View style={styles.careBlock} accessibilityLabel="일정에 맞춘 준비 안내">
            <Text style={styles.careTitle}>이 일정, 이렇게 준비해요</Text>
            <Text style={styles.careGuidance}>{care.guidance}</Text>

            {care.checklist.length > 0 ? (
              <View style={styles.careChecklist}>
                <Text style={styles.careSubLabel}>지금 확인할 것</Text>
                {care.checklist
                  .slice(0, careExpanded ? care.checklist.length : 3)
                  .map((item, index) => (
                    <View key={`${index}:${item}`} style={styles.careItemRow}>
                      <CheckCircle2 size={15} color={colors.sage[500]} />
                      <Text style={styles.careItemText}>{item}</Text>
                    </View>
                  ))}
                {care.checklist.length > 3 ? (
                  <Pressable
                    onPress={() => setCareExpanded((expanded) => !expanded)}
                    style={({ pressed }) => [
                      styles.careToggle,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: careExpanded }}
                  >
                    <Text style={styles.careToggleText}>
                      {careExpanded
                        ? "간단히 보기"
                        : `준비 ${care.checklist.length}개 모두 보기`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {care.script ? (
              <View style={styles.careSubBlock}>
                <Text style={styles.careSubLabel}>이렇게 말해도 좋아요</Text>
                <Text style={styles.careScript}>{care.script}</Text>
              </View>
            ) : null}

            {familyMomentContext ? (
              <View style={styles.careSubBlock}>
                <Text style={styles.careSubLabel}>가족 조율도 우리 방식에 맞춰요</Text>
                <Text style={styles.careQuestion}>
                  이 일정처럼 가족 의견이 필요한 준비에서 누구의 기준을 먼저 볼지 정할 수 있어요.
                </Text>
                <Pressable
                  onPress={() => void openFamilyMomentPersonalization()}
                  disabled={familyPersonalizationPending || pendingAction !== null}
                  style={({ pressed }) => [
                    styles.careChecklistButton,
                    pressed && styles.pressed,
                    (familyPersonalizationPending || pendingAction !== null) && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="가족 조율 방식 맞추기"
                  accessibilityState={{
                    disabled: familyPersonalizationPending || pendingAction !== null,
                  }}
                >
                  <Text style={styles.careChecklistButtonText}>
                    {familyPersonalizationPending ? "연결 상태 확인 중" : "가족 조율 방식 맞추기"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {care.question ? (
              <View style={styles.careSubBlock}>
                <Text style={styles.careSubLabel}>다녀온 뒤 한 가지만 알려주세요</Text>
                <Text style={styles.careQuestion}>{care.question}</Text>
                {privateFollowUpPrompt && expectedPrivateIdentity ? (
                  <Pressable
                    onPress={() => void openPrivateScheduleFollowUp()}
                    disabled={privateFollowUpPending || pendingAction !== null}
                    style={({ pressed }) => [
                      styles.careChecklistButton,
                      pressed && styles.pressed,
                      (privateFollowUpPending || pendingAction !== null) && styles.disabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="아모라와 비공개로 이어서 이야기하기"
                    accessibilityState={{
                      disabled: privateFollowUpPending || pendingAction !== null,
                    }}
                  >
                    <Text style={styles.careChecklistButtonText}>
                      {privateFollowUpPending ? "비공개 대화 준비 중" : "아모라에게 이야기하기"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <Pressable
              onPress={() => router.push({
                pathname: "/checklist",
                params: { category: care.relatedChecklist.categoryKey },
              })}
              style={({ pressed }) => [
                styles.careChecklistButton,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${care.relatedChecklist.categoryLabel} 체크리스트 열기`}
            >
              <Text style={styles.careChecklistButtonText}>
                {care.relatedChecklist.categoryLabel} 체크리스트 보기
              </Text>
            </Pressable>

            {relatedBudget ? (
              <Pressable
                onPress={() => router.push({
                  pathname: "/budget",
                  params: { category: relatedBudget.categoryKey },
                })}
                style={({ pressed }) => [
                  styles.careChecklistButton,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${relatedBudget.categoryLabel} 관련 예산 열기`}
              >
                <Text style={styles.careChecklistButtonText}>
                  관련 예산 확인하기
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.careEvidence}>
              <Text style={styles.careEvidenceText}>
                근거: {care.evidence.refs.map((ref) => ref.label).join(" · ")}
              </Text>
              {care.evidence.limitations.map((limitation, index) => (
                <Text key={`${index}:${limitation}`} style={styles.careLimitation}>
                  · {limitation}
                </Text>
              ))}
            </View>
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
    <AmoraPersonalizationSheet
      visible={familyPersonalizationVisible}
      expectedOwnerUserId={expectedOwnerUserId}
      entryPoint="family_moment"
      familyMomentContext={familyMomentContext ?? undefined}
      onClose={() => setFamilyPersonalizationVisible(false)}
    />
    </>
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
  careBlock: {
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  careTitle: { fontSize: 16, fontWeight: "700", color: colors.noir[800] },
  careGuidance: { fontSize: 14, lineHeight: 22, color: colors.noir[800] },
  careChecklist: { gap: spacing[2] },
  careItemRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  careItemText: { flex: 1, fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  careToggle: { minHeight: 44, alignItems: "flex-start", justifyContent: "center" },
  careToggleText: { fontSize: 13, fontWeight: "600", color: colors.rose[600] },
  careSubBlock: { gap: spacing[1] },
  careSubLabel: { fontSize: 12, fontWeight: "700", color: colors.rose[600] },
  careScript: {
    padding: spacing[3],
    borderRadius: radius.lg,
    fontSize: 13,
    lineHeight: 21,
    color: colors.noir[800],
    backgroundColor: colors.ivory[100],
  },
  careQuestion: { fontSize: 13, lineHeight: 21, color: colors.noir[800] },
  careChecklistButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: colors.rose[500],
    borderRadius: radius.full,
  },
  careChecklistButtonText: { fontSize: 13, fontWeight: "700", color: colors.rose[600] },
  careEvidence: { gap: spacing[1], paddingTop: spacing[2] },
  careEvidenceText: { fontSize: 11, lineHeight: 17, color: colors.textTertiary },
  careLimitation: { fontSize: 11, lineHeight: 17, color: colors.textTertiary },
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
  recoveryStack: { gap: spacing[3] },
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
