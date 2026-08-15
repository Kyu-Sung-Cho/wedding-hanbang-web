import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusEffect } from "expo-router";
import {
  validateMediationOutcomeFollowUpReceiptResponse,
  validateMediationOutcomeFollowUpRequest,
  validateMediationOutcomeFollowUpResponse,
  type MediationOutcomeFollowUpCard,
  type MediationOutcomeFollowUpOutcome,
  type MediationOutcomeFollowUpReceipt,
} from "@hanbang/shared";

import AmoraMediationOutcomeCard from "@/components/dashboard/AmoraMediationOutcomeCard";
import { apiFetchForExpectedUser } from "@/lib/api";
import {
  createFollowUpLifecycleCoordinator,
  type FollowUpLifecycleOperation,
} from "@/lib/followUpLifecycleCoordinator.mjs";
import { hasPrivateMediationSafetyHold } from "@/lib/privateMediationSafetyHold";
import {
  buildMediationOutcomeBody,
  isCurrentMediationOutcomeContext,
  isMediationOutcomeCardAdvanced,
  isReceiptForMediationOutcomeRequest,
  matchCanonicalMediationOutcomeReceipt,
  resolveMediationOutcomeSurface,
  type MediationOutcomeContext,
} from "@/lib/mediationOutcomeFollowUp.mjs";
import { supabase } from "@/lib/supabase";

const CARD_PATH = "/api/amora/mediation/follow-up";
const OUTCOMES_PATH = "/api/amora/mediation/follow-up/outcomes";

type ViewState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "fallback"; context: MediationOutcomeContext }
  | { kind: "ready"; card: MediationOutcomeFollowUpCard; context: MediationOutcomeContext }
  | {
      kind: "receipt";
      card: MediationOutcomeFollowUpCard;
      receipt: MediationOutcomeFollowUpReceipt;
      context: MediationOutcomeContext;
    };

interface AmoraMediationOutcomeFollowUpProps {
  expectedOwnerUserId: string | null;
  expectedCoupleId: string | null;
  loadingFallback?: ReactNode;
  fallback?: ReactNode;
  refreshVersion?: number;
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
    headers: { Accept: "application/json", ...options.headers },
  });
  return {
    status: response.status,
    payload: await response.json().catch(() => null),
  };
}

export default function AmoraMediationOutcomeFollowUp({
  expectedOwnerUserId,
  expectedCoupleId,
  loadingFallback = null,
  fallback = null,
  refreshVersion = 0,
}: AmoraMediationOutcomeFollowUpProps) {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [pendingOutcome, setPendingOutcome] =
    useState<MediationOutcomeFollowUpOutcome | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [authEpoch, setAuthEpoch] = useState(0);
  const lifecycleRef = useRef<ReturnType<typeof createFollowUpLifecycleCoordinator> | null>(null);
  if (!lifecycleRef.current) {
    lifecycleRef.current = createFollowUpLifecycleCoordinator();
  }
  const lifecycle = lifecycleRef.current;
  lifecycle.updateExpected(expectedOwnerUserId, expectedCoupleId);

  const captureContext = useCallback((): MediationOutcomeContext | null => {
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
      setView({ kind: "hidden" });
      return false;
    }
    lifecycle.adoptAuthenticatedUser(verified.value);
    const safetyHold = await lifecycle.runStage(
      operation,
      () => hasPrivateMediationSafetyHold({
        ownerUserId: operation.context.ownerUserId,
        coupleId: operation.context.coupleId,
      }),
    );
    if (safetyHold.status !== "current") return false;
    if (safetyHold.value) {
      setView({ kind: "fallback", context: operation.context });
      return false;
    }
    return true;
  }, [lifecycle]);

  const load = useCallback(async () => {
    if (lifecycle.hasOutcomeInFlight()) return;
    const operation = lifecycle.beginLoad();
    setActionError(null);
    if (!operation) {
      if (captureContext()) return;
      setView({ kind: "hidden" });
      return;
    }
    const captured = operation.context;
    setView({ kind: "loading" });
    try {
      if (!await verifyFreshContext(operation)) return;
      const resultStage = await lifecycle.runStage(
        operation,
        (signal) => readJsonResponse(captured.ownerUserId, CARD_PATH, {
          method: "GET",
          signal,
        }),
      );
      if (resultStage.status !== "current") return;
      const result = resultStage.value;
      if (!await verifyFreshContext(operation)) return;
      const validation = result.status === 200
        ? validateMediationOutcomeFollowUpResponse(
            result.payload,
            captured.ownerUserId,
            captured.coupleId,
          )
        : null;
      const surface = resolveMediationOutcomeSurface(
        result.status,
        validation?.ok ? validation.value.state : null,
      );
      if (surface === "fallback") {
        setView({ kind: "fallback", context: captured });
        return;
      }
      if (!validation?.ok || validation.value.state !== "ready") return;
      setView({ kind: "ready", card: validation.value.card, context: captured });
    } catch (error) {
      if (
        lifecycle.isCurrent(operation)
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        // This is an optional private surface. A read or parsing failure hides
        // only this card and must not displace any ordinary care surface.
        setView({ kind: "fallback", context: captured });
      }
    } finally {
      lifecycle.finish(operation);
    }
  }, [captureContext, lifecycle, verifyFreshContext]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (!lifecycle.updateAuthenticatedUser(nextUserId)) return;
      setPendingOutcome(null);
      setActionError(null);
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

  async function submitOutcome(outcome: MediationOutcomeFollowUpOutcome) {
    if (view.kind !== "ready" || lifecycle.hasOutcomeInFlight() || pendingOutcome) return;
    const captured = captureContext();
    if (!captured || !isCurrentMediationOutcomeContext(view.context, captured)) return;
    const card = view.card;
    const body = buildMediationOutcomeBody({
      id: card.id,
      revision: card.revision,
      sourceDigest: card.sourceDigest,
      outcomeIdempotencyKey: card.outcomeIdempotencyKey,
    }, outcome);
    const bodyValidation = validateMediationOutcomeFollowUpRequest(body);
    if (!body || !bodyValidation.ok) {
      setActionError("최신 카드와 선택을 확인하지 못했어요. 다시 불러와 주세요.");
      return;
    }

    const operation = lifecycle.beginOutcome(captured);
    if (!operation) return;
    setPendingOutcome(outcome);
    setActionError(null);
    try {
      if (!await verifyFreshContext(operation)) return;
      const postedStage = await lifecycle.runStage(
        operation,
        (signal) => readJsonResponse(captured.ownerUserId, OUTCOMES_PATH, {
          method: "POST",
          body: JSON.stringify(bodyValidation.value),
          signal,
        }),
      );
      if (postedStage.status !== "current") return;
      const posted = postedStage.value;
      if (!await verifyFreshContext(operation)) return;
      const postedValidation = posted.status === 200
        ? validateMediationOutcomeFollowUpReceiptResponse(
            posted.payload,
            captured.ownerUserId,
            captured.coupleId,
          )
        : null;
      if (
        !postedValidation?.ok
        || !isReceiptForMediationOutcomeRequest(
          postedValidation.value.receipt,
          bodyValidation.value,
        )
      ) throw new Error("POST_RECEIPT_INVALID");

      const rereadStage = await lifecycle.runStage(
        operation,
        (signal) => readJsonResponse(
          captured.ownerUserId,
          `${OUTCOMES_PATH}?idempotencyKey=${encodeURIComponent(body.idempotencyKey)}`,
          { method: "GET", signal },
        ),
      );
      if (rereadStage.status !== "current") return;
      const reread = rereadStage.value;
      if (!await verifyFreshContext(operation)) return;
      const rereadValidation = reread.status === 200
        ? validateMediationOutcomeFollowUpReceiptResponse(
            reread.payload,
            captured.ownerUserId,
            captured.coupleId,
          )
        : null;
      const canonicalReceipt = rereadValidation?.ok
        ? matchCanonicalMediationOutcomeReceipt(
            postedValidation.value.receipt,
            rereadValidation.value.receipt,
          )
        : null;
      if (
        !canonicalReceipt
        || !isReceiptForMediationOutcomeRequest(canonicalReceipt, bodyValidation.value)
      ) throw new Error("CANONICAL_RECEIPT_MISMATCH");

      const refreshedStage = await lifecycle.runStage(
        operation,
        (signal) => readJsonResponse(captured.ownerUserId, CARD_PATH, {
          method: "GET",
          signal,
        }),
      );
      if (refreshedStage.status !== "current") return;
      const refreshed = refreshedStage.value;
      if (!await verifyFreshContext(operation)) return;
      const refreshedValidation = refreshed.status === 200
        ? validateMediationOutcomeFollowUpResponse(
            refreshed.payload,
            captured.ownerUserId,
            captured.coupleId,
          )
        : null;
      if (
        !refreshedValidation?.ok
        || !isMediationOutcomeCardAdvanced(card, refreshedValidation.value)
      ) throw new Error("CARD_REFETCH_NOT_ADVANCED");

      setView({ kind: "receipt", card, receipt: canonicalReceipt, context: captured });
    } catch (error) {
      if (
        lifecycle.isCurrent(operation)
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        setActionError(
          "서버 영수증을 끝까지 확인하지 못했어요. 저장 완료로 표시하지 않았어요.",
        );
      }
    } finally {
      const operationIsCurrent = lifecycle.isCurrent(operation);
      lifecycle.finish(operation);
      if (operationIsCurrent) {
        setPendingOutcome(null);
      }
    }
  }

  if (view.kind === "hidden") return null;
  if (view.kind === "loading") return loadingFallback;
  const current = captureContext();
  if (view.kind === "fallback") {
    return current && isCurrentMediationOutcomeContext(view.context, current)
      ? fallback
      : null;
  }
  if (!current || !isCurrentMediationOutcomeContext(view.context, current)) return null;

  return (
    <AmoraMediationOutcomeCard
      key={view.card.id}
      card={view.card}
      receipt={view.kind === "receipt" ? view.receipt : null}
      pendingOutcome={pendingOutcome}
      error={actionError}
      onChoose={(outcome) => void submitOutcome(outcome)}
    />
  );
}
