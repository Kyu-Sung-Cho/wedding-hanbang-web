import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, router } from "expo-router";
import * as Crypto from "expo-crypto";
import { RotateCcw } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import {
  validateTodayOneCareV2OutcomeRequest,
  validateTodayOneCareV2OutcomeResponse,
  validateTodayOneCareV2Response,
  type TodayOneCareV2BlockerCode,
  type TodayOneCareV2Card,
  type TodayOneCareV2Outcome,
  type TodayOneCareV2OutcomeReceipt,
} from "@hanbang/shared";

import AmoraPersonalizationSheet from "@/components/chat/AmoraPersonalizationSheet";
import AmoraActionFollowUpCard from "@/components/dashboard/AmoraActionFollowUpCard";
import { apiFetchForExpectedUser } from "@/lib/api";
import {
  buildActionFollowUpPrivateRescueDraft,
  buildActionFollowUpRequestPaths,
  buildActionFollowUpOutcomeBody,
  isActionFollowUpCardAdvanced,
  isCurrentActionFollowUpContext,
  isReceiptForActionFollowUpRequest,
  matchCanonicalActionFollowUpReceipt,
  resolveActionFollowUpWhyNow,
  resolveActionFollowUpV2Surface,
  shouldRetainActionFollowUpReceipt,
  type AmoraActionFollowUpContext,
  type AmoraActionFollowUpRequestPaths,
  type PreferredHomeActionPresentation,
} from "@/lib/amoraActionFollowUp.mjs";
import { stagePrivateChatHandoff } from "@/lib/companionChatHandoff.mjs";
import {
  createFollowUpLifecycleCoordinator,
  type FollowUpLifecycleOperation,
} from "@/lib/followUpLifecycleCoordinator.mjs";
import { supabase } from "@/lib/supabase";

const V2_OUTCOMES_PATH = "/api/amora/today-one/v2/outcomes";

type ViewState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "fallback"; context: AmoraActionFollowUpContext }
  | {
      kind: "ready";
      card: TodayOneCareV2Card;
      context: AmoraActionFollowUpContext;
      requestPaths: AmoraActionFollowUpRequestPaths;
      requestedActionId: string | null;
    }
  | {
      kind: "receipt";
      card: TodayOneCareV2Card;
      receipt: TodayOneCareV2OutcomeReceipt;
      context: AmoraActionFollowUpContext;
      requestPaths: AmoraActionFollowUpRequestPaths;
      requestedActionId: string | null;
      receiptLeaseToken: number | null;
    }
  | {
      kind: "error";
      message: string;
      context: AmoraActionFollowUpContext;
    };

type OutcomePersonalizationEntryPoint =
  | "blocked_action"
  | "uncertain_action"
  | "changed_action"
  | "completed_action";

interface AmoraActionFollowUpV2Props {
  expectedOwnerUserId: string | null;
  expectedCoupleId: string | null;
  preferredActionId?: string | null;
  preferredActionPresentation?: PreferredHomeActionPresentation | null;
  loadingFallback?: ReactNode;
  fallback?: ReactNode;
  refreshVersion?: number;
  receiptReleaseVersion?: number;
  onReceiptSubmissionStarted?: (context: AmoraActionFollowUpContext) => number | null;
  onReceiptSubmissionAborted?: (
    context: AmoraActionFollowUpContext,
    leaseToken: number,
  ) => void | Promise<void>;
  onReceiptPinned?: (
    context: AmoraActionFollowUpContext,
    leaseToken: number,
  ) => boolean;
  onReceiptAcknowledged?: (
    receipt: TodayOneCareV2OutcomeReceipt,
    context: AmoraActionFollowUpContext,
    leaseToken: number,
  ) => void | Promise<void>;
}

interface JsonResponse {
  status: number;
  payload: unknown;
}

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

async function readJsonResponse(
  expectedOwnerUserId: string,
  path: string,
  options: RequestInit,
): Promise<JsonResponse> {
  const response = await apiFetchForExpectedUser(expectedOwnerUserId, path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });
  return {
    status: response.status,
    payload: await response.json().catch(() => null),
  };
}

export default function AmoraActionFollowUpV2({
  expectedOwnerUserId,
  expectedCoupleId,
  preferredActionId = null,
  preferredActionPresentation = null,
  loadingFallback = null,
  fallback = null,
  refreshVersion = 0,
  receiptReleaseVersion = 0,
  onReceiptSubmissionStarted,
  onReceiptSubmissionAborted,
  onReceiptPinned,
  onReceiptAcknowledged,
}: AmoraActionFollowUpV2Props) {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [pendingOutcome, setPendingOutcome] = useState<TodayOneCareV2Outcome | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receiptAcknowledgementPending, setReceiptAcknowledgementPending] = useState(false);
  const [personalizationEntryPoint, setPersonalizationEntryPoint] =
    useState<OutcomePersonalizationEntryPoint | null>(null);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [verifiedFallbackContext, setVerifiedFallbackContext] =
    useState<AmoraActionFollowUpContext | null>(null);
  const lifecycleRef = useRef<ReturnType<typeof createFollowUpLifecycleCoordinator> | null>(null);
  const receiptPinnedContextRef = useRef<AmoraActionFollowUpContext | null>(null);
  const receiptPinnedReleaseVersionRef = useRef<number | null>(null);
  if (!lifecycleRef.current) {
    lifecycleRef.current = createFollowUpLifecycleCoordinator();
  }
  const lifecycle = lifecycleRef.current;
  lifecycle.updateExpected(expectedOwnerUserId, expectedCoupleId);

  useEffect(() => {
    setPersonalizationEntryPoint(null);
  }, [expectedCoupleId, expectedOwnerUserId]);

  const captureContext = useCallback((): AmoraActionFollowUpContext | null => {
    return lifecycle.capture();
  }, [lifecycle]);

  const verifyFreshContext = useCallback(async (
    operation: FollowUpLifecycleOperation,
  ) => {
    const verified = await lifecycle.runStage(
      operation,
      () => currentVerifiedUserId(),
    );
    if (verified.status !== "current") return false;
    if (verified.value !== operation.context.ownerUserId) {
      setVerifiedFallbackContext(null);
      setView({ kind: "hidden" });
      return false;
    }
    lifecycle.adoptAuthenticatedUser(verified.value);
    return true;
  }, [lifecycle]);

  const load = useCallback(async () => {
    const pinnedReceiptContext = receiptPinnedContextRef.current;
    const pinnedReceiptReleaseVersion = receiptPinnedReleaseVersionRef.current;
    const currentContext = captureContext();
    if (shouldRetainActionFollowUpReceipt(
      pinnedReceiptContext,
      currentContext,
      pinnedReceiptReleaseVersion,
      receiptReleaseVersion,
    )) {
      return;
    }
    if (pinnedReceiptContext) {
      receiptPinnedContextRef.current = null;
      receiptPinnedReleaseVersionRef.current = null;
    }
    if (lifecycle.hasOutcomeInFlight()) return;
    const operation = lifecycle.beginLoad();
    setActionError(null);
    if (!operation) {
      if (captureContext()) return;
      setVerifiedFallbackContext(null);
      setView({ kind: "hidden" });
      return;
    }
    const captured = operation.context;
    setView({ kind: "loading" });
    try {
      if (!await verifyFreshContext(operation)) return;
      setVerifiedFallbackContext(captured);
      const requestedActionId = preferredActionId;
      const requestPaths = buildActionFollowUpRequestPaths(requestedActionId);
      if (!requestPaths) {
        setView({ kind: "fallback", context: captured });
        return;
      }
      const responseStage = await lifecycle.runStage(
        operation,
        (signal) => readJsonResponse(captured.ownerUserId, requestPaths.cardPath, {
          method: "GET",
          signal,
        }),
      );
      if (responseStage.status !== "current") return;
      const response = responseStage.value;
      if (!await verifyFreshContext(operation)) return;

      const validation = response.status === 200
        ? validateTodayOneCareV2Response(response.payload, captured.ownerUserId)
        : null;
      const surface = resolveActionFollowUpV2Surface(
        response.status,
        validation?.ok ? validation.value.state : null,
      );
      if (surface === "fallback") {
        setView({ kind: "fallback", context: captured });
        return;
      }
      if (surface !== "ready" || !validation?.ok || !validation.value.card) {
        setView({
          kind: "error",
          message: "후속 행동 응답을 안전하게 확인하지 못했어요. 기존 기록은 바꾸지 않았어요.",
          context: captured,
        });
        return;
      }
      setView({
        kind: "ready",
        card: validation.value.card,
        context: captured,
        requestPaths,
        requestedActionId,
      });
    } catch (error) {
      if (
        lifecycle.isCurrent(operation)
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        setView({
          kind: "error",
          message: "후속 행동을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.",
          context: captured,
        });
      }
    } finally {
      lifecycle.finish(operation);
    }
  }, [
    captureContext,
    lifecycle,
    preferredActionId,
    preferredActionPresentation?.sourceRevision,
    preferredActionPresentation?.title,
    receiptReleaseVersion,
    verifyFreshContext,
  ]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (!lifecycle.updateAuthenticatedUser(nextUserId)) return;
      setPendingOutcome(null);
      setReceiptAcknowledgementPending(false);
      setActionError(null);
      setVerifiedFallbackContext(null);
      receiptPinnedContextRef.current = null;
      receiptPinnedReleaseVersionRef.current = null;
      setView(nextUserId ? { kind: "loading" } : { kind: "hidden" });
      setAuthEpoch((value) => value + 1);
    });
    return () => subscription.unsubscribe();
  }, [lifecycle]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        lifecycle.cancelAll();
        setPendingOutcome(null);
      };
    }, [authEpoch, expectedCoupleId, expectedOwnerUserId, lifecycle, load, refreshVersion]),
  );

  async function submitOutcome(
    outcome: TodayOneCareV2Outcome,
    blockerCode: TodayOneCareV2BlockerCode | null,
    confirmed: boolean,
  ) {
    if (view.kind !== "ready" || lifecycle.hasOutcomeInFlight() || pendingOutcome) return;
    const captured = captureContext();
    if (!captured) return;
    if (!isCurrentActionFollowUpContext(view.context, captured)) return;
    const card = view.card;
    const body = buildActionFollowUpOutcomeBody(
      {
        id: card.id,
        revision: card.revision,
        sourceRevision: card.sourceRevision,
        outcomeIdempotencyKey: card.outcomeIdempotencyKey,
      },
      outcome,
      blockerCode,
      confirmed,
    );
    const bodyValidation = validateTodayOneCareV2OutcomeRequest(body);
    if (!body || !bodyValidation.ok) {
      setActionError("최신 카드와 선택을 확인하지 못했어요. 다시 불러와 주세요.");
      return;
    }

    let receiptLeaseToken: number | null = null;
    if (onReceiptSubmissionStarted) {
      try {
        receiptLeaseToken = onReceiptSubmissionStarted(captured);
      } catch {
        receiptLeaseToken = null;
      }
      if (receiptLeaseToken === null) {
        setActionError("현재 홈과 같은 준비 기록인지 확인하지 못했어요. 다시 불러와 주세요.");
        return;
      }
    }

    const operation = lifecycle.beginOutcome(captured);
    if (!operation) {
      if (receiptLeaseToken !== null) {
        try {
          await onReceiptSubmissionAborted?.(captured, receiptLeaseToken);
        } catch {
          // The parent remains responsible for its owner-bound reload gate.
        }
      }
      return;
    }
    let receiptConfirmed = false;
    setPendingOutcome(outcome);
    setActionError(null);
    try {
      if (!await verifyFreshContext(operation)) return;
      const postedStage = await lifecycle.runStage(
        operation,
        (signal) => readJsonResponse(captured.ownerUserId, view.requestPaths.outcomePath, {
          method: "POST",
          body: JSON.stringify(bodyValidation.value),
          signal,
        }),
      );
      if (postedStage.status !== "current") return;
      const posted = postedStage.value;
      if (!await verifyFreshContext(operation)) return;
      const postedValidation = posted.status === 200
        ? validateTodayOneCareV2OutcomeResponse(posted.payload, captured.ownerUserId)
        : null;
      if (
        !postedValidation?.ok
        || !isReceiptForActionFollowUpRequest(postedValidation.value.receipt, bodyValidation.value)
      ) {
        throw new Error("POST_RECEIPT_INVALID");
      }

      const rereadStage = await lifecycle.runStage(
        operation,
        (signal) => readJsonResponse(
          captured.ownerUserId,
          `${V2_OUTCOMES_PATH}?idempotencyKey=${encodeURIComponent(body.idempotencyKey)}`,
          { method: "GET", signal },
        ),
      );
      if (rereadStage.status !== "current") return;
      const reread = rereadStage.value;
      if (!await verifyFreshContext(operation)) return;
      const rereadValidation = reread.status === 200
        ? validateTodayOneCareV2OutcomeResponse(reread.payload, captured.ownerUserId)
        : null;
      const canonicalReceipt = rereadValidation?.ok
        ? matchCanonicalActionFollowUpReceipt(
            postedValidation.value.receipt,
            rereadValidation.value.receipt,
          )
        : null;
      if (
        !canonicalReceipt
        || !isReceiptForActionFollowUpRequest(canonicalReceipt, bodyValidation.value)
      ) {
        throw new Error("CANONICAL_RECEIPT_MISMATCH");
      }

      const refreshedStage = await lifecycle.runStage(
        operation,
        (signal) => readJsonResponse(captured.ownerUserId, view.requestPaths.cardPath, {
          method: "GET",
          signal,
        }),
      );
      if (refreshedStage.status !== "current") return;
      const refreshed = refreshedStage.value;
      if (!await verifyFreshContext(operation)) return;
      const refreshedValidation = refreshed.status === 200
        ? validateTodayOneCareV2Response(refreshed.payload, captured.ownerUserId)
        : null;
      if (
        !refreshedValidation?.ok
        || !isActionFollowUpCardAdvanced(card, refreshedValidation.value)
      ) {
        throw new Error("CARD_REFETCH_NOT_ADVANCED");
      }

      if (
        receiptLeaseToken !== null
        && onReceiptPinned
        && !onReceiptPinned(captured, receiptLeaseToken)
      ) {
        throw new Error("RECEIPT_LEASE_STALE");
      }
      receiptPinnedContextRef.current = captured;
      receiptPinnedReleaseVersionRef.current = receiptReleaseVersion;
      receiptConfirmed = true;
      setView({
        kind: "receipt",
        card,
        receipt: canonicalReceipt,
        context: captured,
        requestPaths: view.requestPaths,
        requestedActionId: view.requestedActionId,
        receiptLeaseToken,
      });
    } catch (error) {
      if (
        lifecycle.isCurrent(operation)
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        setActionError(
          "선택 결과의 서버 영수증을 다시 확인하지 못했어요. 성공으로 표시하지 않았어요.",
        );
      }
    } finally {
      if (receiptLeaseToken !== null && !receiptConfirmed) {
        try {
          await onReceiptSubmissionAborted?.(captured, receiptLeaseToken);
        } catch {
          // A failed parent refresh must not turn an unverified outcome into success.
        }
      }
      const operationIsCurrent = lifecycle.isCurrent(operation);
      lifecycle.finish(operation);
      if (operationIsCurrent) {
        setPendingOutcome(null);
      }
    }
  }

  async function acknowledgeReceipt() {
    if (view.kind !== "receipt" || receiptAcknowledgementPending) return;
    const current = captureContext();
    if (!current || !isCurrentActionFollowUpContext(view.context, current)) return;
    const pinnedView = view;
    receiptPinnedContextRef.current = null;
    receiptPinnedReleaseVersionRef.current = null;
    setReceiptAcknowledgementPending(true);
    setActionError(null);
    try {
      if (onReceiptAcknowledged) {
        if (view.receiptLeaseToken === null) {
          throw new Error("RECEIPT_LEASE_MISSING");
        }
        await onReceiptAcknowledged(
          view.receipt,
          view.context,
          view.receiptLeaseToken,
        );
      } else {
        await load();
      }
    } catch {
      const latest = captureContext();
      if (latest && isCurrentActionFollowUpContext(pinnedView.context, latest)) {
        receiptPinnedContextRef.current = pinnedView.context;
        receiptPinnedReleaseVersionRef.current = receiptReleaseVersion;
        setActionError("다음 준비를 불러오지 못했어요. 확인 영수증은 그대로 두었어요.");
      }
    } finally {
      setReceiptAcknowledgementPending(false);
    }
  }

  function openPrivateRescue() {
    if (view.kind !== "receipt") return;
    const current = captureContext();
    if (!current || !isCurrentActionFollowUpContext(view.context, current)) return;
    const prompt = buildActionFollowUpPrivateRescueDraft({
      actionTitle: view.card.title,
      outcome: view.receipt.outcome,
      blockerCode: view.receipt.blockerCode ?? null,
    });
    if (!prompt) return;
    const handoff = stagePrivateChatHandoff({
      handoffId: Crypto.randomUUID(),
      ownerUserId: current.ownerUserId,
      coupleId: current.coupleId,
      prompt,
    });
    if (!handoff) {
      router.push("/(tabs)/chat");
      return;
    }
    router.push({ pathname: "/(tabs)/chat", params: { companionHandoff: handoff } });
  }

  function openBlockedPersonalization() {
    if (view.kind !== "receipt" || view.receipt.outcome !== "blocked") return;
    const current = captureContext();
    if (!current || !isCurrentActionFollowUpContext(view.context, current)) return;
    setPersonalizationEntryPoint("blocked_action");
  }

  function openUncertainPersonalization() {
    if (view.kind !== "receipt" || view.receipt.outcome !== "not_sure") return;
    const current = captureContext();
    if (!current || !isCurrentActionFollowUpContext(view.context, current)) return;
    setPersonalizationEntryPoint("uncertain_action");
  }

  function openChangedPersonalization() {
    if (view.kind !== "receipt" || view.receipt.outcome !== "changed") return;
    const current = captureContext();
    if (!current || !isCurrentActionFollowUpContext(view.context, current)) return;
    setPersonalizationEntryPoint("changed_action");
  }

  function openCompletedPersonalization() {
    if (view.kind !== "receipt" || view.receipt.outcome !== "completed") return;
    const current = captureContext();
    if (!current || !isCurrentActionFollowUpContext(view.context, current)) return;
    setPersonalizationEntryPoint("completed_action");
  }

  const current = captureContext();
  const verifiedFallbackIsCurrent = current !== null
    && verifiedFallbackContext !== null
    && isCurrentActionFollowUpContext(verifiedFallbackContext, current);
  if (view.kind === "hidden") return null;
  if (view.kind === "loading") {
    return verifiedFallbackIsCurrent ? loadingFallback : null;
  }
  if (view.kind === "fallback") {
    return current !== null && isCurrentActionFollowUpContext(view.context, current)
      ? fallback
      : null;
  }
  if (!current || !isCurrentActionFollowUpContext(view.context, current)) return null;
  if (view.kind === "error") {
    return (
      <View style={styles.errorStack}>
        {verifiedFallbackIsCurrent ? fallback : null}
        <View style={styles.errorCard} accessibilityRole="alert">
          <RotateCcw size={18} color={colors.rose[600]} />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>행동 후속 확인을 다시 불러와 주세요</Text>
            <Text style={styles.errorDescription}>{view.message}</Text>
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

  return (
    <>
      <AmoraActionFollowUpCard
        card={view.card}
        whyNow={resolveActionFollowUpWhyNow(
          view.card,
          view.requestedActionId,
          preferredActionPresentation,
        )}
        receipt={view.kind === "receipt" ? view.receipt : null}
        receiptAcknowledgementPending={receiptAcknowledgementPending}
        pendingOutcome={pendingOutcome}
        error={actionError}
        onAcknowledgeReceipt={view.kind === "receipt" ? acknowledgeReceipt : undefined}
        onPrivateRescue={view.kind === "receipt" ? openPrivateRescue : undefined}
        onPersonalizeAfterBlocked={
          view.kind === "receipt" && view.receipt.outcome === "blocked"
            ? openBlockedPersonalization
            : undefined
        }
        onPersonalizeAfterUncertain={
          view.kind === "receipt" && view.receipt.outcome === "not_sure"
            ? openUncertainPersonalization
            : undefined
        }
        onPersonalizeAfterChanged={
          view.kind === "receipt" && view.receipt.outcome === "changed"
            ? openChangedPersonalization
            : undefined
        }
        onPersonalizeAfterCompleted={
          view.kind === "receipt" && view.receipt.outcome === "completed"
            ? openCompletedPersonalization
            : undefined
        }
        onSubmit={submitOutcome}
      />
      <AmoraPersonalizationSheet
        visible={personalizationEntryPoint !== null}
        expectedOwnerUserId={current.ownerUserId}
        entryPoint={personalizationEntryPoint ?? "general"}
        onClose={() => setPersonalizationEntryPoint(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  errorStack: { gap: spacing[3] },
  errorCard: {
    flexDirection: "row",
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.ivory[100],
  },
  errorCopy: { flex: 1, gap: spacing[1] },
  errorTitle: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  errorDescription: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  retryButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing[2],
  },
  retryText: { fontSize: 13, fontWeight: "600", color: colors.rose[600] },
  pressed: { opacity: 0.72 },
});
