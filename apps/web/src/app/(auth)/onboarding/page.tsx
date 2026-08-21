"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOnboardingStore } from "@/stores/onboardingStore";
import Logo from "@/components/ui/Logo";
import StepIndicator from "@/components/onboarding/StepIndicator";
import RoleSelection from "@/components/onboarding/RoleSelection";
import NeutralPreparationStart from "@/components/onboarding/NeutralPreparationStart";
import CoupleLink from "@/components/onboarding/CoupleLink";
import WeddingDetails from "@/components/onboarding/WeddingDetails";
import WeddingStylePreferences from "@/components/onboarding/WeddingStylePreferences";
import ProgressChecklist from "@/components/onboarding/ProgressChecklist";
import { buildJoinedDashboardRedirect } from "@/lib/amora/dashboardCompanion";
import { getAuthRedirectPath } from "@/lib/auth/safeRedirect";
import { describeInviteDeadline } from "@hanbang/shared";
import {
  buildNeutralPreparationPrefill,
  buildNeutralPreparationSpaceSubmission,
  parseNeutralPreparationSpaceCapability,
  resolveNeutralPreparationSpaceRedirect,
} from "@/lib/onboarding/neutralPreparationSpace";
import { copyOwnerBoundInviteCode } from "@/lib/couples/settingsInviteActorFence";
import { createClient } from "@/lib/supabase/client";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

type OwnerBoundInviteCode = Readonly<{
  code: string;
  ownerUserId: string;
}>;

async function writeClipboardTextWithFallback(
  value: string,
  canWriteSensitiveFallback: () => Promise<boolean>,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Some webviews and permission policies expose Clipboard but reject it.
  }

  if (value.length > 0 && !await canWriteSensitiveFallback()) {
    throw new Error("CLIPBOARD_OWNER_CHANGED");
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.readOnly = true;
  textArea.tabIndex = -1;
  document.body.appendChild(textArea);
  try {
    textArea.select();
    if (!document.execCommand("copy")) {
      throw new Error("CLIPBOARD_FALLBACK_FAILED");
    }
  } finally {
    textArea.remove();
  }
}
import type { WeddingPriorityValue } from "@hanbang/shared";

export default function OnboardingPage() {
  const store = useOnboardingStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteCodeResult, setInviteCodeResult] =
    useState<OwnerBoundInviteCode | null>(null);
  // 코드를 보내는 그 화면이 기한을 말해야 한다. 서버가 모르면 아무 말도 안 한다.
  const [inviteDeadline, setInviteDeadline] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [pendingPlanNotice, setPendingPlanNotice] = useState("");
  const [deferredProgressNotice, setDeferredProgressNotice] = useState("");
  const [formOwnerUserId, setFormOwnerUserId] = useState<string | null>(null);
  const [ownerVerification, setOwnerVerification] = useState<
    "checking" | "ready" | "error"
  >("checking");
  const [neutralPreparationSpaceEnabled, setNeutralPreparationSpaceEnabled] =
    useState(false);
  const formOwnerUserIdRef = useRef<string | null>(null);
  const inviteCodeResultRef = useRef<OwnerBoundInviteCode | null>(null);
  const ownerCheckGenerationRef = useRef(0);
  const submissionGenerationRef = useRef(0);

  const clearOwnerBoundInviteResult = useCallback((
    expectedResult?: OwnerBoundInviteCode,
  ) => {
    if (expectedResult && inviteCodeResultRef.current !== expectedResult) return;
    inviteCodeResultRef.current = null;
    setInviteCodeResult(null);
    setShowInviteModal(false);
    setCodeCopied(false);
  }, []);

  const clearAccountOwnedOnboardingState = useCallback(() => {
    submissionGenerationRef.current += 1;
    useOnboardingStore.getState().clearOwner();
    formOwnerUserIdRef.current = null;
    setFormOwnerUserId(null);
    setLoading(false);
    setError("");
    clearOwnerBoundInviteResult();
    setPendingPlanNotice("");
    setDeferredProgressNotice("");
    setNeutralPreparationSpaceEnabled(false);
  }, [clearOwnerBoundInviteResult]);

  const reconcileOnboardingOwner = useCallback(async () => {
    const generation = ownerCheckGenerationRef.current + 1;
    ownerCheckGenerationRef.current = generation;
    const previousOwnerUserId = useOnboardingStore.getState().ownerUserId;

    // focus/visibility 복귀 때 서버 owner가 확인되기 전에는 A의 폼을 숨긴다.
    formOwnerUserIdRef.current = null;
    setFormOwnerUserId(null);
    setOwnerVerification("checking");

    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (ownerCheckGenerationRef.current !== generation) return;
      if (!res.ok) {
        clearAccountOwnedOnboardingState();
        window.location.href = "/login";
        return;
      }

      const data = await res.json();
      if (ownerCheckGenerationRef.current !== generation) return;
      const ownerUserId = typeof data.user?.id === "string" ? data.user.id : null;
      if (!ownerUserId) {
        clearAccountOwnedOnboardingState();
        window.location.href = "/login";
        return;
      }

      if (previousOwnerUserId !== null && previousOwnerUserId !== ownerUserId) {
        clearAccountOwnedOnboardingState();
      }
      useOnboardingStore.getState().bindOwner(ownerUserId);
      setNeutralPreparationSpaceEnabled(
        parseNeutralPreparationSpaceCapability(data.capabilities),
      );
      formOwnerUserIdRef.current = ownerUserId;
      setFormOwnerUserId(ownerUserId);
      setError("");
      setOwnerVerification("ready");

      if (data.profile?.onboarding_completed) {
        document.cookie = "onboarding_complete=true; path=/; max-age=31536000";
        window.location.href = getAuthRedirectPath(
          window.location.search,
          window.location.origin,
        );
      }
    } catch {
      if (ownerCheckGenerationRef.current !== generation) return;
      setOwnerVerification("error");
      setError("계정을 안전하게 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.");
    }
  }, [clearAccountOwnedOnboardingState]);
  // 중립 경로 전용 입력. 예식일은 스토어의 weddingDate 를 그대로 재사용하고,
  // 관심사는 저장이 아니라 첫 대화 초안을 만드는 데 쓴다.
  const [neutralFocus, setNeutralFocus] = useState<WeddingPriorityValue | null>(null);

  // 이미 온보딩 완료한 유저인지 확인
  useEffect(() => {
    const supabase = createClient();
    void reconcileOnboardingOwner();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const currentOwnerUserId = useOnboardingStore.getState().ownerUserId;
        const nextOwnerUserId = session?.user.id ?? null;
        if (currentOwnerUserId === nextOwnerUserId) return;

        // Auth event는 비동기 재확인보다 먼저 A의 초안·결과를 폐기한다.
        ownerCheckGenerationRef.current += 1;
        clearAccountOwnedOnboardingState();
        setOwnerVerification("checking");
        void reconcileOnboardingOwner();
      },
    );

    const handleOwnerFocus = () => {
      void reconcileOnboardingOwner();
    };

    const handleOwnerVisibility = () => {
      if (document.visibilityState === "visible") {
        void reconcileOnboardingOwner();
      } else {
        formOwnerUserIdRef.current = null;
        setFormOwnerUserId(null);
        setOwnerVerification("checking");
      }
    };

    window.addEventListener("focus", handleOwnerFocus);
    document.addEventListener("visibilitychange", handleOwnerVisibility);

    return () => {
      ownerCheckGenerationRef.current += 1;
      formOwnerUserIdRef.current = null;
      subscription.unsubscribe();
      window.removeEventListener("focus", handleOwnerFocus);
      document.removeEventListener("visibilitychange", handleOwnerVisibility);
    };
  }, [clearAccountOwnedOnboardingState, reconcileOnboardingOwner]);

  const formOwnerReady =
    ownerVerification === "ready"
    && formOwnerUserId !== null
    && formOwnerUserIdRef.current === formOwnerUserId;
  const inviteCodeForCurrentOwner =
    formOwnerReady
    && inviteCodeResult !== null
    && inviteCodeResultRef.current === inviteCodeResult
    && inviteCodeResult.ownerUserId === formOwnerUserId
    && store.ownerUserId === formOwnerUserId
      ? inviteCodeResult.code
      : null;

  if (!formOwnerReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[480px] text-center">
          <Logo size="md" />
          <div className="mt-8 rounded-3xl border border-black/[0.04] bg-white/80 p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-[20px]">
            <h1 className="text-[18px] font-semibold text-noir-800">
              {ownerVerification === "error"
                ? "계정을 확인하지 못했어요"
                : "계정을 안전하게 확인하고 있어요"}
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed text-taupe-500">
              확인이 끝나기 전에는 이전 계정의 입력을 화면에 표시하지 않아요.
            </p>
            {ownerVerification === "error" && (
              <button
                type="button"
                onClick={() => void reconcileOnboardingOwner()}
                className="mt-6 w-full rounded-2xl bg-[#795252] py-3 text-[14px] font-medium text-white transition-colors hover:bg-[#946a6a]"
              >
                다시 확인하기
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const canProceed = () => {
    if (!formOwnerUserId) return false;
    switch (store.currentStep) {
      case 1:
        return store.role !== null;
      case 2:
        if (store.coupleAction === "join") {
          return /^WH-[A-Z0-9]{6,12}$/.test(store.partnerInviteCode);
        }
        return store.coupleAction !== null;
      case 3:
        return true;
      case 4:
        return true; // 스타일 선호도는 선택사항 (스킵 가능)
      case 5:
        return true;
      default:
        return false;
    }
  };

  const getCompletionRedirectSearch = () => {
    const requestedPath = getAuthRedirectPath(
      window.location.search,
      window.location.origin,
    );
    // 랜딩에서 시작한 명시적 목적지가 있으면 가입 전 맥락을 우선 보존한다.
    // 별도 목적지 없이 파트너에게 참여한 경우에만 연결 결과를 대시보드에 알린다.
    if (
      store.coupleAction !== "join"
      || requestedPath !== "/wedding/lounge"
    ) {
      return window.location.search;
    }
    return `?${new URLSearchParams({
      redirect: buildJoinedDashboardRedirect(),
    })}`;
  };

  // neutralCoupleAction이 있으면 중립 준비 공간 경로다 — 역할·장소·예산·스타일은
  // 묻지 않는다. 예식일만 받는데, 아모라가 대신 받아낼 수 없는 유일한 값이기
  // 때문이다(첫 인사는 저장 정보를 못 꺼내고, 도구 게이트가 자족 확정문만 통과).
  const handleSubmit = async (
    neutralCoupleAction?: "create" | "join",
  ) => {
    const expectedActorUserId = formOwnerUserIdRef.current;
    if (!expectedActorUserId) {
      setError("계정을 확인하지 못했어요. 다시 로그인한 뒤 이어가 주세요.");
      return;
    }
    const submissionGeneration = submissionGenerationRef.current + 1;
    submissionGenerationRef.current = submissionGeneration;
    const submissionOwnerStillCurrent = () => (
      submissionGenerationRef.current === submissionGeneration
      && formOwnerUserIdRef.current === expectedActorUserId
    );
    setLoading(true);
    setError("");

    try {
      let requestBody: Record<string, unknown>;
      if (neutralCoupleAction) {
        if (!neutralPreparationSpaceEnabled) {
          throw new Error("NEUTRAL_PREPARATION_SPACE_NOT_ENABLED");
        }
        requestBody = buildNeutralPreparationSpaceSubmission({
          coupleAction: neutralCoupleAction,
          partnerInviteCode: store.partnerInviteCode,
          weddingDate: store.weddingDate,
          focusPriority: neutralFocus,
        });
      } else {
        const progress: Record<string, unknown> = {};
        store.progressChecklist.forEach((item) => {
          // 입력한 실제 지출만 원 단위로 저장한다. 계획 예산은 사용자가 예산
          // 화면에서 별도로 입력하며, 실제 지출을 예산으로 추정하지 않는다.
          const costInWon = item.status === "completed" && item.cost ? item.cost * 10000 : null;
          progress[item.key] = costInWon
            ? { status: item.status, spent: costInWon }
            : { status: item.status };
        });

        // 결혼식 선호도 저장
        progress.__preferences = {
          weddingStyle: store.preferences.weddingStyle,
          priorities: store.preferences.priorities,
          budgetTendency: store.preferences.budgetTendency,
          guestCount: store.preferences.guestCount,
        };
        requestBody = {
          role: store.role,
          coupleAction: store.coupleAction,
          partnerInviteCode:
            store.coupleAction === "join" ? store.partnerInviteCode : undefined,
          weddingDate: store.weddingDateUndecided ? null : store.weddingDate,
          venue: store.venueUndecided ? null : store.venue,
          sanggyeonryeDate: store.sanggyeonryeUndecided ? null : store.sanggyeonryeDate,
          totalBudget: store.approximateBudget > 0
            ? { amount: store.approximateBudget, unit: "won" }
            : null,
          progress,
        };
      }

      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
          [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: expectedActorUserId,
        },
        body: JSON.stringify(requestBody),
      });

      const ownerResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const ownerData = ownerResponse.ok ? await ownerResponse.json() : null;
      if (
        !submissionOwnerStillCurrent()
        || ownerData?.user?.id !== expectedActorUserId
      ) {
        // 서버 세션이 먼저 바뀌고 auth event가 늦게 온 경우에도 A의 상태를 즉시 폐기한다.
        if (formOwnerUserIdRef.current === expectedActorUserId) {
          clearAccountOwnedOnboardingState();
          setOwnerVerification("checking");
          void reconcileOnboardingOwner();
        }
        return;
      }

      const data = await res.json();
      if (!submissionOwnerStillCurrent()) return;

      if (!res.ok) {
        setError(data.error ?? "온보딩 저장에 실패했습니다.");
        return;
      }

      // 온보딩 완료 쿠키 설정
      document.cookie = "onboarding_complete=true; path=/; max-age=31536000";

      if (neutralCoupleAction) {
        // 새로 만든 경우 초대 코드를 보여준다. 안 보여주면 상대를 부르려고
        // 설정 화면을 뒤져야 한다 — 함께 준비하는 게 이 제품의 요지인데.
        if (neutralCoupleAction === "create" && typeof data.inviteCode === "string") {
          if (!submissionOwnerStillCurrent()) return;
          const ownerBoundInviteCode = {
            code: data.inviteCode,
            ownerUserId: expectedActorUserId,
          } satisfies OwnerBoundInviteCode;
          inviteCodeResultRef.current = ownerBoundInviteCode;
          setInviteCodeResult(ownerBoundInviteCode);
          void loadInviteDeadline();
          setShowInviteModal(true);
          return;
        }
        window.location.href = resolveNeutralPreparationSpaceRedirect({
          search: window.location.search,
          origin: window.location.origin,
          prefill: buildNeutralPreparationPrefill({
            weddingDate: typeof data.journey?.wedding_date === "string"
              ? data.journey.wedding_date
              : null,
            focusPriority: neutralFocus,
          }),
        });
        return;
      }

      if (typeof data.inviteCode === "string") {
        const ownerBoundInviteCode = {
          code: data.inviteCode,
          ownerUserId: expectedActorUserId,
        } satisfies OwnerBoundInviteCode;
        inviteCodeResultRef.current = ownerBoundInviteCode;
        setInviteCodeResult(ownerBoundInviteCode);
        void loadInviteDeadline();
      }

      const isPendingPartner =
        data.planChange?.status === "pending_partner"
        && typeof data.planChange.summary === "string";
      const hasDeferredRoutineProgress =
        data.routineProgress?.status === "deferred"
        && typeof data.routineProgress.message === "string";
      if (isPendingPartner) {
        setPendingPlanNotice(data.planChange.summary);
      }
      if (hasDeferredRoutineProgress) {
        setDeferredProgressNotice(data.routineProgress.message);
      }
      if (isPendingPartner || hasDeferredRoutineProgress) {
        return;
      }

      // 초대코드가 있고 "새로 시작하기"인 경우 모달 표시
      if (data.inviteCode && store.coupleAction === "create") {
        setShowInviteModal(true);
        // 리다이렉트 하지 않음 → 모달에서 사용자가 직접 이동
      } else {
        window.location.href = getAuthRedirectPath(
          getCompletionRedirectSearch(),
          window.location.origin,
        );
      }
    } catch (submitError) {
      if (formOwnerUserIdRef.current !== expectedActorUserId) return;
      setError(
        submitError instanceof Error
          && submitError.message === "INVALID_NEUTRAL_PREPARATION_INVITE_CODE"
          ? "초대 코드 형식을 다시 확인해 주세요."
          : "오류가 발생했습니다. 다시 시도해주세요.",
      );
    } finally {
      if (submissionGenerationRef.current === submissionGeneration) {
        setLoading(false);
      }
    }
  };

  const handleSkipChecklist = async () => {
    // 체크리스트를 모두 not_started로 유지한 채 제출
    await handleSubmit();
  };

  /**
   * 기한은 /api/couple/code 에서 읽는다. 온보딩 라우트는 couples 를 직접 만지지
   * 않는 경계를 지켜야 해서(그 경계는 테스트로 고정돼 있다) 여기서 따로 묻는다.
   * 못 읽으면 아무 말도 하지 않는다 — 없는 기한을 지어내지 않고, 코드 표시를
   * 막지도 않는다.
   */
  const loadInviteDeadline = async () => {
    try {
      const res = await fetch("/api/couple/code");
      if (!res.ok) return;
      const payload: unknown = await res.json().catch(() => null);
      const expiresAt = typeof payload === "object" && payload !== null
        ? (payload as { inviteCodeExpiresAt?: unknown }).inviteCodeExpiresAt
        : null;
      setInviteDeadline(describeInviteDeadline(expiresAt));
    } catch {
      // 조용히 넘어간다.
    }
  };

  const verifyCanonicalOnboardingOwner = async (expectedOwnerUserId: string) => {
    const localOwnerStillCurrent = () => (
      formOwnerUserId === expectedOwnerUserId
      && formOwnerUserIdRef.current === expectedOwnerUserId
      && useOnboardingStore.getState().ownerUserId === expectedOwnerUserId
    );
    if (!localOwnerStillCurrent()) return false;

    try {
      const ownerResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const ownerData = ownerResponse.ok ? await ownerResponse.json() : null;
      const canonicalOwnerUserId = typeof ownerData?.user?.id === "string"
        ? ownerData.user.id
        : null;
      if (
        canonicalOwnerUserId !== expectedOwnerUserId
        || !localOwnerStillCurrent()
      ) {
        if (localOwnerStillCurrent()) {
          clearAccountOwnedOnboardingState();
          setOwnerVerification("checking");
          void reconcileOnboardingOwner();
        }
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const handleCopyCode = async () => {
    const resultToCopy = inviteCodeResult;
    if (!resultToCopy) return;

    const resultOwnerStillCurrent = () => (
      inviteCodeResultRef.current === resultToCopy
      && formOwnerUserId === resultToCopy.ownerUserId
      && formOwnerUserIdRef.current === resultToCopy.ownerUserId
      && useOnboardingStore.getState().ownerUserId === resultToCopy.ownerUserId
    );

    try {
      const didCopy = await copyOwnerBoundInviteCode({
        connectionOwnerId: resultToCopy.ownerUserId,
        inviteCode: resultToCopy.code,
        readCurrentSettingsOwner: () => (
          resultOwnerStillCurrent() ? resultToCopy.ownerUserId : null
        ),
        readAuthenticatedOwner: async () => (
          await verifyCanonicalOnboardingOwner(resultToCopy.ownerUserId)
            ? resultToCopy.ownerUserId
            : null
        ),
        writeText: (value) => writeClipboardTextWithFallback(value, async () => (
          resultOwnerStillCurrent()
          && await verifyCanonicalOnboardingOwner(resultToCopy.ownerUserId)
          && resultOwnerStillCurrent()
        )),
        purgeOwnerBoundSecret: () => clearOwnerBoundInviteResult(resultToCopy),
      });
      if (!didCopy) return;
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Clipboard failures remain unacknowledged. The shared fence separately
      // purges and clears any secret copied during a late account switch.
    }
  };

  const continueAfterPendingPlan = async () => {
    const expectedOwnerUserId = formOwnerUserId;
    if (
      !expectedOwnerUserId
      || !await verifyCanonicalOnboardingOwner(expectedOwnerUserId)
    ) {
      if (inviteCodeResult) clearOwnerBoundInviteResult(inviteCodeResult);
      setPendingPlanNotice("");
      setDeferredProgressNotice("");
      return;
    }
    setPendingPlanNotice("");
    setDeferredProgressNotice("");
    if (store.coupleAction === "create") {
      if (!inviteCodeForCurrentOwner) {
        if (inviteCodeResult) clearOwnerBoundInviteResult(inviteCodeResult);
        return;
      }
      setShowInviteModal(true);
      return;
    }
    window.location.href = getAuthRedirectPath(
      getCompletionRedirectSearch(),
      window.location.origin,
    );
  };

  const continueAfterInviteResult = async () => {
    const resultToContinue = inviteCodeResult;
    if (
      !resultToContinue
      || inviteCodeResultRef.current !== resultToContinue
      || formOwnerUserIdRef.current !== resultToContinue.ownerUserId
      || useOnboardingStore.getState().ownerUserId !== resultToContinue.ownerUserId
    ) {
      if (resultToContinue) clearOwnerBoundInviteResult(resultToContinue);
      return;
    }
    if (!await verifyCanonicalOnboardingOwner(resultToContinue.ownerUserId)) {
      clearOwnerBoundInviteResult(resultToContinue);
      return;
    }
    if (
      inviteCodeResultRef.current !== resultToContinue
      || formOwnerUserIdRef.current !== resultToContinue.ownerUserId
      || useOnboardingStore.getState().ownerUserId !== resultToContinue.ownerUserId
    ) {
      clearOwnerBoundInviteResult(resultToContinue);
      return;
    }
    window.location.href = neutralPreparationSpaceEnabled
      ? resolveNeutralPreparationSpaceRedirect({
          search: window.location.search,
          origin: window.location.origin,
          prefill: buildNeutralPreparationPrefill({
            weddingDate: store.weddingDate || null,
            focusPriority: neutralFocus,
          }),
        })
      : getAuthRedirectPath(
          window.location.search,
          window.location.origin,
        );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[480px]">
        {/* 로고 */}
        <div className="text-center mb-8">
          <Logo size="md" />
          <p className="text-[13px] text-taupe-400 mt-2">결혼 준비 시작하기</p>
        </div>

        {/* 중립 준비공간은 첫 가치를 막는 역할·상세정보 스텝을 건너뛴다. */}
        {!neutralPreparationSpaceEnabled && (
          <StepIndicator currentStep={store.currentStep} />
        )}

        {/* 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
          {neutralPreparationSpaceEnabled ? (
            <NeutralPreparationStart
              coupleAction={store.coupleAction === "join" ? "join" : null}
              partnerCode={store.partnerInviteCode}
              loading={loading}
              onCreate={() => {
                store.setCoupleAction("create");
                void handleSubmit("create");
              }}
              onSelectJoin={() => {
                setError("");
                store.setCoupleAction("join");
              }}
              onPartnerCodeChange={store.setPartnerInviteCode}
              onJoin={() => void handleSubmit("join")}
              weddingDate={store.weddingDate ?? ""}
              onWeddingDateChange={store.setWeddingDate}
              focusPriority={neutralFocus}
              onFocusPriorityChange={setNeutralFocus}
            />
          ) : (
          <>
          <AnimatePresence mode="wait">
            <motion.div
              key={store.currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {store.currentStep === 1 && (
                <RoleSelection
                  selected={store.role}
                  onSelect={store.setRole}
                />
              )}
              {store.currentStep === 2 && (
                <CoupleLink
                  coupleAction={store.coupleAction}
                  onSelectAction={store.setCoupleAction}
                  partnerCode={store.partnerInviteCode}
                  onPartnerCodeChange={store.setPartnerInviteCode}
                />
              )}
              {store.currentStep === 3 && (
                <WeddingDetails
                  weddingDate={store.weddingDate}
                  weddingDateUndecided={store.weddingDateUndecided}
                  venue={store.venue}
                  venueUndecided={store.venueUndecided}
                  sanggyeonryeDate={store.sanggyeonryeDate}
                  sanggyeonryeUndecided={store.sanggyeonryeUndecided}
                  budget={store.approximateBudget}
                  onDateChange={store.setWeddingDate}
                  onDateUndecidedChange={store.setWeddingDateUndecided}
                  onVenueChange={store.setVenue}
                  onVenueUndecidedChange={store.setVenueUndecided}
                  onSanggyeonryeDateChange={store.setSanggyeonryeDate}
                  onSanggyeonryeUndecidedChange={store.setSanggyeonryeUndecided}
                  onBudgetChange={store.setBudget}
                />
              )}
              {store.currentStep === 4 && (
                <WeddingStylePreferences
                  preferences={store.preferences}
                  onStyleChange={store.setWeddingStyle}
                  onTogglePriority={store.togglePriority}
                  onBudgetTendencyChange={store.setBudgetTendency}
                  onGuestCountChange={store.setGuestCount}
                />
              )}
              {store.currentStep === 5 && (
                <ProgressChecklist
                  items={store.progressChecklist}
                  onStatusChange={store.setChecklistItemStatus}
                  onCostChange={store.setChecklistItemCost}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* 버튼 */}
          <div className="flex gap-3 mt-6">
            {store.currentStep > 1 && (
              <button
                onClick={store.prevStep}
                className="px-6 py-3 rounded-2xl text-[14px] font-medium border border-black/[0.08] text-taupe-500 hover:bg-black/[0.02] transition-all"
              >
                이전
              </button>
            )}
            {store.currentStep < 5 ? (
              <div className="flex-1 flex flex-col gap-2">
                <button
                  onClick={() => {
                    // 파트너 코드로 참여 시, step 2 다음에 바로 제출 (3,4,5 스킵)
                    if (store.currentStep === 2 && store.coupleAction === "join") {
                      handleSubmit();
                      return;
                    }
                    store.nextStep();
                  }}
                  disabled={!canProceed() || (store.currentStep === 2 && store.coupleAction === "join" && loading)}
                  className="w-full py-3 rounded-2xl text-[14px] font-medium transition-all bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {store.currentStep === 2 && store.coupleAction === "join"
                    ? loading ? "연결 중..." : "파트너와 연결하기"
                    : "다음"}
                </button>
                {/* 스타일 선호도 스킵 버튼 */}
                {store.currentStep === 4 && (
                  <button
                    onClick={() => store.nextStep()}
                    className="w-full py-2.5 rounded-2xl text-[13px] font-medium text-taupe-400 hover:text-taupe-500 hover:bg-black/[0.02] transition-all"
                  >
                    나중에 설정할게요
                  </button>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-2">
                <button
                  onClick={() => void handleSubmit()}
                  disabled={loading}
                  className="w-full py-3 rounded-2xl text-[14px] font-medium transition-all bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] disabled:opacity-50"
                >
                  {loading ? "저장 중..." : "시작하기"}
                </button>
                <button
                  onClick={handleSkipChecklist}
                  disabled={loading}
                  className="w-full py-2.5 rounded-2xl text-[13px] font-medium text-taupe-400 hover:text-taupe-500 hover:bg-black/[0.02] transition-all"
                >
                  나중에 하기
                </button>
              </div>
            )}
          </div>
          </>
          )}

          {/* 에러 */}
          {error && (
            <p className="text-[12px] text-rose-600 text-center mt-4">{error}</p>
          )}

        </div>
      </div>

      {/* 초대코드 모달 */}
      <AnimatePresence>
        {(pendingPlanNotice || deferredProgressNotice) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-plan-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-[400px] rounded-3xl bg-white p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
            >
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#795252]/10 text-2xl">
                🤝
              </div>
              <h3
                id="pending-plan-title"
                className="mb-2 text-[20px] font-semibold text-noir-800"
              >
                {pendingPlanNotice
                  ? "파트너 확인을 요청했어요"
                  : "저장되지 않은 입력이 있어요"}
              </h3>
              {pendingPlanNotice && (
                <p className="mb-3 text-[13px] leading-relaxed text-taupe-500">
                  {pendingPlanNotice}
                </p>
              )}
              {pendingPlanNotice && (
                <p
                  className={`${deferredProgressNotice ? "mb-3" : "mb-6"} text-[12px] leading-relaxed text-taupe-400`}
                >
                  아직 계획에는 반영되지 않았어요. 두 사람이 모두 확인하면 자동으로 반영됩니다.
                </p>
              )}
              {deferredProgressNotice && (
                <p className="mb-6 text-[12px] leading-relaxed text-rose-700">
                  {deferredProgressNotice}
                </p>
              )}
              <button
                type="button"
                onClick={continueAfterPendingPlan}
                className="w-full rounded-2xl bg-[#795252] py-3 text-[14px] font-medium text-white transition-colors hover:bg-[#946a6a]"
              >
                확인하고 계속하기
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showInviteModal && inviteCodeForCurrentOwner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-[400px] bg-white rounded-3xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.15)] text-center"
            >
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-rose-500/10 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#795252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>

              <h3 className="text-[20px] font-semibold text-noir-800 mb-2">
                파트너 초대 코드
              </h3>
              <p className="text-[13px] text-taupe-400 mb-5 leading-relaxed">
                아래 코드를 파트너에게 공유하세요.
                <br />
                파트너가 이 코드로 가입하면 함께 준비할 수 있어요!
              </p>

              <div className="bg-ivory-100 rounded-2xl p-5 mb-5">
                <p className="text-[28px] font-mono font-bold text-noir-800 tracking-[0.15em]">
                  {inviteCodeForCurrentOwner}
                </p>
                {inviteDeadline && (
                  <p className="mt-3 text-[13px] font-medium text-[#795252]">
                    {inviteDeadline}
                  </p>
                )}
              </div>

              <button
                onClick={handleCopyCode}
                className={`w-full py-3 rounded-2xl text-[14px] font-medium transition-all mb-3 ${
                  codeCopied
                    ? "bg-green-500 text-white"
                    : "bg-[#795252] text-white hover:bg-[#946a6a]"
                }`}
              >
                {codeCopied ? "복사 완료!" : "코드 복사하기"}
              </button>

              <button
                onClick={continueAfterInviteResult}
                className="w-full py-3 rounded-2xl text-[14px] font-medium text-taupe-500 hover:text-noir-800 hover:bg-black/[0.02] transition-all"
              >
                결혼 준비 계속하기
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
