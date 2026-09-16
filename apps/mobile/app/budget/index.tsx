// 예산 관리 — 웹과 동일한 wedding_journeys.progress 기반
// budget/spent만 합산한다. legacy cost는 용도 확인 전까지 검토값으로만 표시한다.
import { useEffect, useState, useCallback, useRef } from "react";
import { View, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl, Modal, Alert, KeyboardAvoidingView, Platform, Animated, AppState } from "react-native";
import { Text, TextInput } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { TrendingDown, TrendingUp, Wallet, Edit3, Check, X, AlertTriangle } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  PLANNING_CATEGORY_LABELS,
  PREPARATION_PROGRESS_STATUS_LABELS,
  type PlanningCategoryKey,
} from "@hanbang/shared/constants";
import { supabase } from "@/lib/supabase";
import { apiFetchForExpectedUser } from "@/lib/api";
import {
  buildCategoryBudgetMutation,
  buildTotalBudgetMutation,
  createBudgetRevisionCoordinator,
  fetchActiveBudgetApprovalStatus,
  isBudgetEditBaseCurrent,
  isPendingBudgetApprovalBoundToIdentity,
  parseBudgetApprovalStatusResponse,
  parseBudgetMutationResponse,
  type BudgetEditBase,
  type BudgetIdentityToken,
  type BudgetMutationToken,
} from "@/lib/budgetRevision.mjs";
import { listBudgetCategories } from "@/lib/budgetCategoryRegistry.mjs";
import {
  isSkippedBudgetCategoryWithoutMoney,
  readBudgetCategoryStatus,
  type BudgetCategoryStatus,
} from "@/lib/budgetCategoryStatus.mjs";
import { AppHeader, LoadingState, StatusPill, Surface } from "@/components/ui/AppUI";
import {
  FeatureSummarySurface,
  SummaryPill,
  summaryColors,
} from "@/components/ui/FeatureSummary";
import ErrorRetry from "@/components/ErrorRetry";
import BudgetShareChart from "@/components/budget/BudgetShareChart";
import BudgetSideSplit from "@/components/budget/BudgetSideSplit";
import { foldPayerSides, formatWonExact as formatWon } from "@hanbang/shared/budget-share";

// 분담 타입 (웹과 동일)
type PayerType = "couple" | "bride_parents" | "groom_parents" | "both_parents";

const PAYER_OPTIONS: { value: PayerType; label: string }[] = [
  { value: "couple", label: "두 사람" },
  { value: "bride_parents", label: "예비 신부 가족" },
  { value: "groom_parents", label: "예비 신랑 가족" },
  { value: "both_parents", label: "두 가족" },
];

// 업체·상품마다 다른 포함/별도 확인 항목. 금액은 공시가 또는 사용자 견적에서만 표시한다.
const HIDDEN_COSTS: Record<string, { warning: string; guidance: string }> = {
  studio: { warning: "받는 사진 파일 수, 앨범, 밝기와 색을 다듬어 주는 사진 수의 포함 범위", guidance: "업체 공개 가격·견적서 확인" },
  dress: { warning: "속옷, 장갑, 머리에 쓰는 면사포, 신발의 포함 범위", guidance: "업체 서면 안내 확인" },
  makeup: { warning: "미리 받아보는 메이크업, 부모님 메이크업, 피부 관리의 포함 범위", guidance: "업체 서면 안내 확인" },
  venue: { warning: "결혼식 진행자, 축하 노래, 영상, 꽃 장식, 결혼식 뒤 전통 인사 공간의 포함 범위", guidance: "업체 공개 가격·견적서 확인" },
  honeymoon: { warning: "보험, 선택 일정, 현지 비용의 포함 범위", guidance: "예약 문서 기준 확인" },
  hanbok: { warning: "수선, 소품, 세탁의 포함 범위", guidance: "업체 서면 안내 확인" },
  gift: { warning: "포장, 배송, 추가 수량의 포함 범위", guidance: "업체 서면 안내 확인" },
  snap: { warning: "편집한 영상, 받는 사진 파일 수, 액자의 포함 범위", guidance: "업체 공개 가격·견적서 확인" },
  ham: { warning: "장식, 운송, 주차의 포함 범위", guidance: "업체 서면 안내 확인" },
  bouquet: { warning: "꽃 보존, 예식 정장에 다는 꽃, 두 가족에게 드리는 꽃의 포함 범위", guidance: "업체 서면 안내 확인" },
};

// 금액은 사용자가 입력하거나 계약·예약 결과로 확인된 값만 사용한다.
const BUDGET_CATEGORY_KEYS: PlanningCategoryKey[] = [
  "greeting", "meeting", "venue", "studio", "dress", "makeup", "snap", "ring", "yedan",
  "hanbok", "shoes", "bouquet", "honeymoon", "houseware", "housing",
  "invitation", "gift", "mc", "ham", "pyebaek", "registration", "reserve",
];

const BUDGET_CATEGORIES = BUDGET_CATEGORY_KEYS.map((key) => ({
  key,
  label: PLANNING_CATEGORY_LABELS[key],
}));

interface ProgressItem {
  status?: string;
  budget?: number;
  spent?: number;
  cost?: number;
  payer?: PayerType;
  [key: string]: unknown;
}

type RiskTone = "neutral" | "rose" | "warning" | "danger";

interface BudgetRisk {
  id: string;
  title: string;
  detail: string;
  tone: RiskTone;
  categoryKey?: string;
}

interface PendingBudgetApproval {
  ownerId: string;
  coupleId: string;
  surface: "/budget";
  requestId: string;
  summary: string;
  expectedRevision: number;
  verification: "pending" | "unverified";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toBudgetProgress(
  progress: Record<string, unknown>,
): Record<string, ProgressItem> {
  return Object.fromEntries(
    Object.entries(progress).filter((entry): entry is [string, ProgressItem] => {
      return isRecord(entry[1]);
    }),
  );
}

function readSafeErrorMessage(value: unknown): string | null {
  if (!isRecord(value) || typeof value.error !== "string") return null;
  if (
    value.error.length === 0
    || Array.from(value.error).length > 300
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.error)
  ) return null;
  return value.error;
}

function isSessionOwnerMismatch(error: unknown): boolean {
  return error instanceof Error
    && (
      error.message === "API_SESSION_OWNER_MISMATCH"
      || error.message === "MOBILE_WEB_API_SESSION_OWNER_MISMATCH"
    );
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (
    error.message.startsWith("INVALID_")
    || error.message.length === 0
    || Array.from(error.message).length > 300
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(error.message)
  ) return fallback;
  return error.message;
}

function normalizeLegacyCostForReview(cost: unknown): number | null {
  if (!Number.isSafeInteger(cost) || (cost as number) <= 0) return null;
  const normalized = (cost as number) < 100_000
    ? (cost as number) * 10_000
    : (cost as number);
  return Number.isSafeInteger(normalized) && normalized <= 1_000_000_000
    ? normalized
    : null;
}

export default function BudgetScreen() {
  const [totalBudget, setTotalBudget] = useState(0);
  const [rawProgress, setProgress] = useState<Record<string, unknown>>({});
  const progress = toBudgetProgress(rawProgress);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [spentInput, setSpentInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [payerInput, setPayerInput] = useState<PayerType>("couple");
  const [saving, setSaving] = useState(false);
  const [savingTotal, setSavingTotal] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingBudgetApproval | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const loadSequenceRef = useRef(0);
  const pendingApprovalRef = useRef<PendingBudgetApproval | null>(null);
  const totalEditBaseRef = useRef<BudgetEditBase | null>(null);
  const categoryEditBaseRef = useRef<BudgetEditBase | null>(null);
  const revisionCoordinatorRef = useRef<ReturnType<typeof createBudgetRevisionCoordinator> | null>(null);
  if (revisionCoordinatorRef.current === null) {
    revisionCoordinatorRef.current = createBudgetRevisionCoordinator();
  }
  const revisionCoordinator = revisionCoordinatorRef.current;

  const clearIdentityBoundState = useCallback(() => {
    setTotalBudget(0);
    setProgress({});
    setCoupleId(null);
    setEditingTotal(false);
    setEditingKey(null);
    totalEditBaseRef.current = null;
    categoryEditBaseRef.current = null;
    setSaving(false);
    setSavingTotal(false);
    pendingApprovalRef.current = null;
    setPendingApproval(null);
  }, []);

  const commitSnapshotToView = useCallback((snapshot: BudgetIdentityToken) => {
    setCoupleId(snapshot.coupleId);
    setTotalBudget(snapshot.totalBudget);
    setProgress(snapshot.progress);

    const pending = pendingApprovalRef.current;
    if (pending && !isPendingBudgetApprovalBoundToIdentity(pending, snapshot)) {
      pendingApprovalRef.current = null;
      setPendingApproval(null);
    }
  }, []);

  const loadData = useCallback(async (authorizedMutationToken?: BudgetMutationToken) => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    let loadToken: ReturnType<typeof revisionCoordinator.beginLoad> = null;
    const hadIdentity = revisionCoordinator.captureIdentity() !== null;
    if (!hadIdentity) setLoading(true);
    setLoadError(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (loadSequenceRef.current !== loadSequence) return null;
      if (userError || !user) {
        revisionCoordinator.setOwner(null);
        clearIdentityBoundState();
        return null;
      }

      if (revisionCoordinator.setOwner(user.id)) clearIdentityBoundState();
      loadToken = authorizedMutationToken
        ? revisionCoordinator.beginLoad(user.id, authorizedMutationToken)
        : revisionCoordinator.beginLoad(user.id);
      if (!loadToken) return null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .single();
      if (
        loadSequenceRef.current !== loadSequence
        || !revisionCoordinator.isLoadCurrent(loadToken)
      ) return null;
      if (profileError || typeof profile?.couple_id !== "string") {
        throw new Error("INVALID_BUDGET_PROFILE");
      }

      const { data: journey, error: journeyError } = await supabase
        .from("wedding_journeys")
        .select("couple_id, total_budget, progress, state_revision")
        .eq("couple_id", profile.couple_id)
        .single();
      if (
        loadSequenceRef.current !== loadSequence
        || !revisionCoordinator.isLoadCurrent(loadToken)
      ) return null;
      if (journeyError || !journey) throw new Error("INVALID_BUDGET_JOURNEY");

      const snapshot = revisionCoordinator.commitJourney(
        loadToken,
        journey,
        profile.couple_id,
      );
      if (!snapshot) throw new Error("INVALID_BUDGET_JOURNEY");
      commitSnapshotToView(snapshot);
      let latestSnapshot = snapshot;

      const pendingAtLoadStart = pendingApprovalRef.current;
      if (pendingApprovalRef.current === null) {
        try {
          const recovered = await fetchActiveBudgetApprovalStatus({
            apiFetch: (path, options) => apiFetchForExpectedUser(snapshot.ownerId, path, options),
            ownerId: snapshot.ownerId,
            coupleId: snapshot.coupleId,
            currentRevision: snapshot.stateRevision,
          });
          if (
            loadSequenceRef.current !== loadSequence
            || !revisionCoordinator.isCurrent(snapshot)
          ) return null;

          if (recovered?.outcome.status === "pending_partner") {
            const recoveredPending: PendingBudgetApproval = {
              ownerId: recovered.approval.ownerId,
              coupleId: recovered.approval.coupleId,
              surface: recovered.approval.surface,
              requestId: recovered.approval.requestId,
              summary: recovered.approval.summary,
              expectedRevision: recovered.approval.baseRevision,
              verification: "pending",
            };
            pendingApprovalRef.current = recoveredPending;
            setPendingApproval(recoveredPending);
          } else if (
            recovered?.outcome.status === "applied"
            && "journey" in recovered.outcome
          ) {
            const observed = revisionCoordinator.commitObservedApplied(
              snapshot,
              recovered.outcome.journey,
              recovered.approval.baseRevision,
            );
            if (!observed) throw new Error("PENDING_BUDGET_APPLIED_MISMATCH");
            commitSnapshotToView(observed);
            latestSnapshot = observed;
          }
        } catch (recoveryError) {
          if (isSessionOwnerMismatch(recoveryError)) return null;
        }
      }

      const pending = pendingAtLoadStart;
      if (
        pending
        && isPendingBudgetApprovalBoundToIdentity(pending, snapshot)
      ) {
        try {
          const statusResponse = await apiFetchForExpectedUser(
            pending.ownerId,
            `/api/couple-plan-changes/${pending.requestId}`,
            { method: "GET" },
          );
          const statusPayload: unknown = await statusResponse.json().catch(() => null);
          if (
            loadSequenceRef.current !== loadSequence
            || !revisionCoordinator.isCurrent(snapshot)
          ) return null;
          if (!statusResponse.ok) throw new Error("PENDING_BUDGET_STATUS_UNAVAILABLE");

          const pendingOutcome = parseBudgetApprovalStatusResponse(
            statusPayload,
            snapshot.coupleId,
            pending.expectedRevision,
            snapshot.stateRevision,
          );
          if (
            pendingOutcome.requestId !== pending.requestId
            || pendingOutcome.summary !== pending.summary
          ) {
            throw new Error("PENDING_BUDGET_STATUS_MISMATCH");
          }

          if (pendingOutcome.status === "pending_partner") {
            const verifiedPending = {
              ...pending,
              summary: pendingOutcome.summary,
              verification: "pending" as const,
            };
            pendingApprovalRef.current = verifiedPending;
            setPendingApproval(verifiedPending);
          } else if (pendingOutcome.status === "applied" && "journey" in pendingOutcome) {
            const observed = revisionCoordinator.commitObservedApplied(
              snapshot,
              pendingOutcome.journey,
              pending.expectedRevision,
            );
            if (!observed) throw new Error("PENDING_BUDGET_APPLIED_MISMATCH");
            pendingApprovalRef.current = null;
            setPendingApproval(null);
            commitSnapshotToView(observed);
            latestSnapshot = observed;
          } else if (
            pendingOutcome.status === "stale"
            || pendingOutcome.status === "rejected"
          ) {
            pendingApprovalRef.current = null;
            setPendingApproval(null);
            // 카드만 지우고 아무 말도 안 하면, 파트너가 **거절한** 화면과
            // **승인한** 화면이 똑같아진다 — 둘 다 카드가 사라지고 예산은
            // 그대로다. 두 사람이 확인해야 반영된다는 경계가 "내 입력이
            // 사라졌다"로 읽힌다.
            //
            // 문구는 능동 경로(`reloadAfterConflict`)가 이미 쓰는 것을 그대로
            // 쓴다. 같은 결과를 두 경로가 다르게 말할 이유가 없다. 상태를 바로
            // 위에서 비웠으므로 다음 폴링에서 다시 뜨지 않는다.
            Alert.alert(
              pendingOutcome.status === "rejected"
                ? "이번 변경은 반영되지 않았어요"
                : "예산 기록이 바뀌었어요",
              pendingOutcome.status === "rejected"
                ? "파트너가 동의하지 않았거나 요청이 이미 종료됐어요. 기존 예산을 유지하고 최신 내용을 불러올게요."
                : "다른 기기나 파트너가 먼저 수정했을 수 있어요. 최신 예산을 불러온 뒤 다시 입력해 주세요.",
            );
          } else {
            throw new Error("PENDING_BUDGET_STATUS_MISMATCH");
          }
        } catch (statusError) {
          if (isSessionOwnerMismatch(statusError)) return null;
          if (
            loadSequenceRef.current === loadSequence
            && revisionCoordinator.isCurrent(snapshot)
          ) {
            const unverifiedPending = {
              ...pending,
              verification: "unverified" as const,
            };
            pendingApprovalRef.current = unverifiedPending;
            setPendingApproval(unverifiedPending);
          }
        }
      }
      return latestSnapshot;
    } catch (error) {
      if (
        loadSequenceRef.current === loadSequence
        && loadToken
        && revisionCoordinator.isLoadCurrent(loadToken)
      ) {
        console.error("Budget load:", error);
        setLoadError("예산 기록을 안전하게 확인하지 못했어요. 최신 내용을 다시 불러와 주세요.");
      }
      return null;
    } finally {
      if (loadSequenceRef.current === loadSequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [clearIdentityBoundState, commitSnapshotToView, revisionCoordinator]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      let appState = AppState.currentState;
      const subscription = AppState.addEventListener("change", (nextState) => {
        const previousState = appState;
        appState = nextState;
        if (nextState === "active" && previousState !== "active") {
          void loadData();
        }
      });
      return () => {
        subscription.remove();
        loadSequenceRef.current += 1;
      };
    }, [loadData])
  );

  useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const nextOwnerId = session?.user.id ?? null;
        if (!revisionCoordinator.setOwner(nextOwnerId)) return;

        loadSequenceRef.current += 1;
        clearIdentityBoundState();
        setLoadError(null);
        setRefreshing(false);
        setLoading(nextOwnerId !== null);
        if (reloadTimer !== null) clearTimeout(reloadTimer);
        if (nextOwnerId) {
          reloadTimer = setTimeout(() => {
            void loadData();
          }, 0);
        }
      },
    );

    return () => {
      if (reloadTimer !== null) clearTimeout(reloadTimer);
      loadSequenceRef.current += 1;
      revisionCoordinator.setOwner(null);
      subscription.unsubscribe();
    };
  }, [clearIdentityBoundState, loadData, revisionCoordinator]);

  useEffect(() => {
    if (!coupleId) return;

    let active = true;
    const reload = () => { if (active) void loadData(); };
    const channel = supabase.channel(`budget:${coupleId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "wedding_journeys",
        filter: `couple_id=eq.${coupleId}`,
      }, reload)
      .subscribe((status) => {
        // 연결이 끊긴 동안 빠진 변경은 이벤트 재전송에 의존하지 않고 다시 읽는다.
        if (status === "SUBSCRIBED") reload();
      });

    channelRef.current = channel;

    return () => {
      active = false;
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [coupleId, loadData]);

  function getCatBudget(key: string): number {
    const item = progress[key];
    if (Number.isSafeInteger(item?.budget) && (item?.budget ?? 0) >= 0) {
      return item!.budget!;
    }
    return 0;
  }
  function getCatSpent(key: string): number {
    const item = progress[key];
    if (Number.isSafeInteger(item?.spent) && (item?.spent ?? 0) >= 0) {
      return item!.spent!;
    }
    return 0;
  }
  // 상태는 키로 읽는다. 이름은 온보딩·체크리스트와 같은 공유 사전(아직·준비 중·완료·안 해요)에서
  // 붙인다 — 예전에는 "안 해요"로 고른 항목도 여기서만 "예정"으로 보였다.
  function getCatStatus(key: string): BudgetCategoryStatus {
    return readBudgetCategoryStatus(progress[key]);
  }
  function getCatPayer(key: string): PayerType {
    return progress[key]?.payer ?? "couple";
  }

  const budgetCategories = listBudgetCategories({
    fixedCategories: BUDGET_CATEGORIES,
    progress: rawProgress,
  });
  /**
   * 화면에 행으로 그리는 항목. "안 해요"로 고른 기본 항목에 금액이 하나도 없으면 뺀다(웹과 같다).
   * 합계·분담·비중은 위 `budgetCategories` 로 계속 센다 — 빠진 행은 금액이 0이라 합계가 같다.
   */
  const fixedBudgetKeys = new Set<string>(BUDGET_CATEGORY_KEYS);
  const budgetRows = budgetCategories.filter((category) =>
    !(fixedBudgetKeys.has(category.key) && isSkippedBudgetCategoryWithoutMoney(progress[category.key])),
  );

  // 분담별 지출 합계
  const payerSummary = budgetCategories.reduce(
    (acc, c) => {
      const payer = getCatPayer(c.key);
      const spent = getCatSpent(c.key);
      acc[payer] = (acc[payer] ?? 0) + spent;
      return acc;
    },
    {} as Record<PayerType, number>,
  );

  const totalSpent = budgetCategories.reduce((s, c) => s + getCatSpent(c.key), 0);

  /**
   * 양측 분담 — `payer` 네 값을 세 기둥으로 접는다. 웹 예산 화면과 **같은 함수**를
   * 부르므로 두 앱이 같은 커플에게 다른 기둥을 말할 수 없다.
   */
  const payerSides = foldPayerSides(payerSummary);
  const remaining = totalBudget - totalSpent;
  const spentPct = totalBudget > 0 ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;
  const allocatedBudget = budgetCategories.reduce((sum, category) => {
    return sum + getCatBudget(category.key);
  }, 0);

  /**
   * 항목별 비중에 넘길 조각들.
   *
   * **여기서 progress 를 다시 읽지 않는다.** 이 화면의 합계를 만든 것과 같은
   * `getCatSpent`/`getCatBudget` 과 같은 목록(`budgetCategories`)을 쓴다. 따로 세면
   * 도넛 총액과 위 카드 총액이 갈린다.
   *
   * 기록 지출이 아직 0이면 배정 예산으로 그린다 — 첫날에도 "어디에 얼마를 잡았나" 는
   * 답할 수 있어야 한다.
   */
  const shareBasis: "spent" | "budget" = totalSpent > 0 ? "spent" : "budget";
  const shareSlices = budgetCategories.map((category) => ({
    key: category.key,
    label: category.label,
    amount: shareBasis === "spent" ? getCatSpent(category.key) : getCatBudget(category.key),
  }));
  const legacyReviewItems = Object.entries(progress).flatMap(([key, item]) => {
    if (!Object.prototype.hasOwnProperty.call(item, "cost")) return [];
    const category = budgetCategories.find((candidate) => candidate.key === key);
    const customLabel = typeof item.label === "string" && item.label.trim()
      ? item.label.trim()
      : null;
    return [{
      key,
      label: category?.label ?? customLabel ?? "사용자 항목",
      amount: normalizeLegacyCostForReview(item.cost),
    }];
  });

  const categoryOverruns = budgetCategories
    .map((cat) => {
      const budget = getCatBudget(cat.key);
      const spent = getCatSpent(cat.key);
      return {
        ...cat,
        budget,
        spent,
        overrun: budget > 0 ? spent - budget : 0,
      };
    })
    .filter((cat) => cat.overrun > 0)
    .sort((a, b) => b.overrun - a.overrun);

  const hiddenCostWatch = budgetCategories
    .filter((cat) => HIDDEN_COSTS[cat.key] && getCatStatus(cat.key) !== "completed")
    .map((cat) => {
      const budget = getCatBudget(cat.key);
      const spent = getCatSpent(cat.key);
      const useRate = budget > 0 ? spent / budget : 0;
      return { ...cat, budget, spent, useRate };
    })
    .filter((cat) => cat.spent > 0 || cat.useRate >= 0.7)
    .sort((a, b) => b.useRate - a.useRate);

  const budgetRisks: BudgetRisk[] = [
    ...(totalBudget <= 0
      ? [{
          id: "missing-total",
          title: "총 예산을 입력해주세요",
          detail: "전체 예산과 기록 지출의 차이를 계산하려면 총 예산이 필요해요.",
          tone: "warning" as const,
        }]
      : []),
    // 총 예산을 정하기 전에는 초과를 말하지 않는다 — 0원 대비 초과는 사실이 아니다(웹은 "계산 전").
    ...(totalBudget > 0 && remaining < 0
      ? [{
          id: "total-overrun",
          title: `총 예산 ${formatWon(Math.abs(remaining))} 초과`,
          detail: "기록값을 확인한 뒤 카테고리별 초과 항목을 먼저 조정하세요.",
          tone: "danger" as const,
        }]
      : []),
    ...categoryOverruns.map((cat) => ({
      id: `overrun-${cat.key}`,
      title: `${cat.label} 예산 초과`,
      detail: `${formatWon(cat.overrun)} 초과 · 입력한 예산 ${formatWon(cat.budget)} / 기록 지출 ${formatWon(cat.spent)}`,
      tone: "danger" as const,
      categoryKey: cat.key,
    })),
    ...hiddenCostWatch.map((cat) => {
      const hidden = HIDDEN_COSTS[cat.key]!;
      return {
        id: `hidden-${cat.key}`,
        title: `${cat.label} 포함·별도 항목 체크`,
        detail: `${hidden.warning} · ${hidden.guidance}`,
        tone: "warning" as const,
        categoryKey: cat.key,
      };
    }),
  ].slice(0, 3);

  const budgetStatus =
    totalBudget <= 0
      ? { label: "입력 필요", tone: "warning" as const }
      : remaining < 0
        ? { label: "예산 초과", tone: "danger" as const }
        : budgetRisks.length > 0
          ? { label: "확인할 항목", tone: "warning" as const }
          : { label: "입력값 확인", tone: "success" as const };

  useEffect(() => {
    Animated.timing(progressAnim, { toValue: spentPct, duration: 800, useNativeDriver: false }).start();
  }, [spentPct, progressAnim]);

  function closeEditorForMutation(token: BudgetMutationToken) {
    if (token.kind === "total") {
      totalEditBaseRef.current = null;
      setEditingTotal(false);
    }
    if (token.kind === "category") {
      categoryEditBaseRef.current = null;
      setEditingKey(null);
    }
  }

  async function reloadAfterConflict(
    token: BudgetMutationToken,
    reason: "active" | "stale" | "rejected",
  ) {
    if (!revisionCoordinator.isCurrent(token)) return;
    closeEditorForMutation(token);
    Alert.alert(
      reason === "active"
        ? "먼저 대기 중인 확인 요청이 있어요"
        : reason === "rejected"
          ? "이번 변경은 반영되지 않았어요"
          : "예산 기록이 바뀌었어요",
      reason === "active"
        ? "파트너가 기존 요청을 확인하거나 보낸 사람이 철회한 뒤 다시 변경해 주세요. 최신 예산을 불러올게요."
        : reason === "rejected"
          ? "파트너가 동의하지 않았거나 요청이 이미 종료됐어요. 기존 예산을 유지하고 최신 내용을 불러올게요."
          : "다른 기기나 파트너가 먼저 수정했을 수 있어요. 최신 예산을 불러온 뒤 다시 입력해 주세요.",
    );
    await loadData(token);
  }

  async function submitBudgetMutation(
    token: BudgetMutationToken,
    body: Record<string, unknown>,
  ) {
    if (!revisionCoordinator.isCurrent(token)) return;

    const response = await apiFetchForExpectedUser(
      token.ownerId,
      "/api/journey",
      {
        method: "PATCH",
        body: JSON.stringify({ ...body, expected_couple_id: token.coupleId }),
      },
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!revisionCoordinator.isCurrent(token)) return;

    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === "string"
        ? payload.code
        : null;
      if (response.status === 409) {
        let status: "stale" | "rejected" | null = null;
        try {
          const parsed = parseBudgetMutationResponse(
            payload,
            token.coupleId,
            token.stateRevision,
          );
          status = parsed.status === "stale" || parsed.status === "rejected"
            ? parsed.status
            : null;
        } catch {
          // 활성 요청 오류는 request envelope가 아니므로 code로만 판별한다.
        }
        if (
          status
          || code === "PLAN_CHANGE_STALE"
          || code === "PLAN_CHANGE_CONFLICT"
          || code === "PLAN_CHANGE_REJECTED"
          || code === "PLAN_CHANGE_ACTIVE_REQUEST"
        ) {
          await reloadAfterConflict(
            token,
            code === "PLAN_CHANGE_ACTIVE_REQUEST"
              ? "active"
              : status === "rejected" || code === "PLAN_CHANGE_REJECTED"
                ? "rejected"
                : "stale",
          );
          return;
        }
      }
      throw new Error(
        readSafeErrorMessage(payload)
        ?? "예산 변경 요청을 안전하게 처리하지 못했어요.",
      );
    }

    const outcome = parseBudgetMutationResponse(
      payload,
      token.coupleId,
      token.stateRevision,
    );
    if (!revisionCoordinator.isCurrent(token)) return;

    if (outcome.status === "pending_partner") {
      const pending: PendingBudgetApproval = {
        ownerId: token.ownerId,
        coupleId: token.coupleId,
        surface: "/budget",
        requestId: outcome.requestId,
        summary: outcome.summary,
        expectedRevision: token.stateRevision,
        verification: "pending",
      };
      pendingApprovalRef.current = pending;
      setPendingApproval(pending);
      closeEditorForMutation(token);
      Alert.alert(
        "파트너 확인을 요청했어요",
        "아직 저장된 것은 아니에요. 파트너가 동의하면 예산에 반영돼요.",
      );
      return;
    }

    if (outcome.status === "stale" || outcome.status === "rejected") {
      await reloadAfterConflict(token, outcome.status);
      return;
    }

    if (!("journey" in outcome)) {
      throw new Error("예산 변경 결과를 확인하지 못했어요.");
    }
    const committed = revisionCoordinator.commitApplied(token, outcome.journey);
    if (!committed) throw new Error("예산 변경 결과의 revision을 확인하지 못했어요.");
    commitSnapshotToView(committed);
    closeEditorForMutation(token);
    Alert.alert("예산을 반영했어요", "최신 예산 기록에 안전하게 저장했어요.");
    await loadData(token);
  }

  async function saveTotalBudget() {
    const token = revisionCoordinator.beginMutation("total");
    if (!token) return;
    setSavingTotal(true);
    try {
      if (!isBudgetEditBaseCurrent(totalEditBaseRef.current, token)) {
        closeEditorForMutation(token);
        Alert.alert(
          "총 예산이 바뀌었어요",
          "편집을 시작한 뒤 최신 기록이 달라졌어요. 새 값을 확인한 뒤 다시 입력해 주세요.",
        );
        await loadData(token);
        return;
      }
      const body = buildTotalBudgetMutation(token, totalInput);
      if (!revisionCoordinator.isCurrent(token)) return;
      await submitBudgetMutation(token, body);
    } catch (error) {
      if (isSessionOwnerMismatch(error)) return;
      if (!revisionCoordinator.isCurrent(token)) return;
      const message = error instanceof Error && error.message === "INVALID_MANWON_AMOUNT"
        ? "만원 단위 숫자를 정확히 입력해 주세요."
        : mutationErrorMessage(error, "총 예산 변경 요청에 실패했어요.");
      Alert.alert("총 예산을 반영하지 못했어요", message);
    } finally {
      if (revisionCoordinator.finishMutation(token)) setSavingTotal(false);
    }
  }

  async function saveCategoryEdit() {
    if (!editingKey) return;
    const categoryKey = editingKey;
    const token = revisionCoordinator.beginMutation("category");
    if (!token) return;
    setSaving(true);
    try {
      if (!isBudgetEditBaseCurrent(categoryEditBaseRef.current, token)) {
        closeEditorForMutation(token);
        Alert.alert(
          "카테고리 예산이 바뀌었어요",
          "편집을 시작한 뒤 최신 기록이 달라졌어요. 새 값을 확인한 뒤 다시 입력해 주세요.",
        );
        await loadData(token);
        return;
      }
      const body = buildCategoryBudgetMutation(token, {
        categoryKey,
        budgetInput,
        spentInput,
        payer: payerInput,
      });
      if (!revisionCoordinator.isCurrent(token)) return;
      await submitBudgetMutation(token, body);
    } catch (error) {
      if (isSessionOwnerMismatch(error)) return;
      if (!revisionCoordinator.isCurrent(token)) return;
      const message = error instanceof Error && error.message === "INVALID_MANWON_AMOUNT"
        ? "예산과 기록 지출은 만원 단위 숫자로 정확히 입력해 주세요."
        : mutationErrorMessage(error, "카테고리 예산 변경 요청에 실패했어요.");
      Alert.alert("예산을 반영하지 못했어요", message);
    } finally {
      if (revisionCoordinator.finishMutation(token)) setSaving(false);
    }
  }

  function openEdit(key: string) {
    const identity = revisionCoordinator.captureIdentity();
    if (!identity) return;
    totalEditBaseRef.current = null;
    setEditingTotal(false);
    categoryEditBaseRef.current = {
      ownerId: identity.ownerId,
      coupleId: identity.coupleId,
      stateRevision: identity.stateRevision,
    };
    setBudgetInput(getCatBudget(key) > 0 ? String(getCatBudget(key) / 10000) : "");
    setSpentInput(getCatSpent(key) > 0 ? String(getCatSpent(key) / 10000) : "");
    setPayerInput(getCatPayer(key));
    setEditingKey(key);
  }

  function openTotalEdit() {
    const identity = revisionCoordinator.captureIdentity();
    if (!identity) return;
    totalEditBaseRef.current = {
      ownerId: identity.ownerId,
      coupleId: identity.coupleId,
      stateRevision: identity.stateRevision,
    };
    setTotalInput(totalBudget > 0 ? String(totalBudget / 10000) : "");
    setEditingTotal(true);
  }

  function closeTotalEditor() {
    if (savingTotal) return;
    totalEditBaseRef.current = null;
    setEditingTotal(false);
  }

  function closeCategoryEditor() {
    if (saving) return;
    categoryEditBaseRef.current = null;
    setEditingKey(null);
  }

  function showHiddenCostAlert(key: string) {
    const data = HIDDEN_COSTS[key];
    if (!data) return;
    const label = budgetCategories.find((category) => category.key === key)?.label ?? key;
    Alert.alert(
      `${label} 포함·별도 항목 확인`,
      `${data.warning}\n\n${data.guidance}`,
      [{ text: "확인" }],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <LoadingState label="예산 현황을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={s.container}>
        <ErrorRetry
          message={loadError}
          onRetry={() => {
            setLoading(true);
            void loadData();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader
        title="예산 관리"
        subtitle="기록 지출, 분담, 포함·별도 항목을 함께 봐요"
        onBack={() => router.back()}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadData(); }} tintColor={colors.rose[500]} />}>

        {pendingApproval && (
          <Surface style={s.pendingApprovalCard}>
            <View style={s.pendingApprovalHeader}>
              <Text style={s.pendingApprovalTitle}>
                {pendingApproval.verification === "pending"
                  ? "파트너 확인 대기"
                  : "승인 상태 확인 필요"}
              </Text>
              <StatusPill
                label={pendingApproval.verification === "pending" ? "아직 미반영" : "재확인 필요"}
                tone="warning"
              />
            </View>
            <Text style={s.pendingApprovalSummary}>{pendingApproval.summary}</Text>
            <Text style={s.pendingApprovalDescription}>
              {pendingApproval.verification === "pending"
                ? "파트너가 동의하기 전에는 예산에 저장되지 않아요. 승인함에서 요청 상태를 확인할 수 있어요."
                : "요청 번호는 보관했지만 현재 상태를 다시 확인하지 못했어요. 화면을 새로고침하거나 승인함에서 확인해 주세요."}
            </Text>
            <Text style={s.pendingApprovalReference}>
              요청 번호 {pendingApproval.requestId.slice(-8)}
            </Text>
            <Pressable
              style={({ pressed }) => [
                s.pendingApprovalRefresh,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => {
                setRefreshing(true);
                void loadData();
              }}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel="예산 변경 승인 상태 다시 확인"
              accessibilityState={{ disabled: refreshing, busy: refreshing }}
            >
              <Text style={s.pendingApprovalRefreshText}>
                {refreshing ? "확인 중…" : "상태 다시 확인"}
              </Text>
            </Pressable>
          </Surface>
        )}

        {/* 예산 요약 — 웹 예산 요약과 같은 샴페인 요약 면. 총 예산·진행 막대·배정/기록 지출/잔여를
            한 면에 모아 아래 내용 카드와 구분한다. 어두운 카드에서는 초과 빨강 `#EF4444`(2.23:1)와
            회색 라벨(3.69:1)이 읽기 기준에 못 미쳤다. 글자색은 전부 `summaryColors` 에서 온다. */}
        <FeatureSummarySurface style={s.totalCard}>
          <View style={s.totalTop}>
            <Text style={s.totalLabel}>예산 운영 상태</Text>
            <SummaryPill label={budgetStatus.label} tone={budgetStatus.tone} />
          </View>
          {editingTotal ? (
            <View style={s.editRow}>
              <TextInput style={s.totalEditInput} value={totalInput} onChangeText={setTotalInput} keyboardType="decimal-pad" autoFocus editable={!savingTotal} maxLength={11} accessibilityLabel="총 예산 만원 단위 입력" placeholder="0" placeholderTextColor={summaryColors.label} />
              <Text style={s.totalUnit}>만원</Text>
              <Pressable onPress={saveTotalBudget} disabled={savingTotal} accessibilityRole="button" accessibilityLabel="총 예산 변경 요청" accessibilityState={{ disabled: savingTotal, busy: savingTotal }}>
                {savingTotal
                  ? <ActivityIndicator size="small" color={summaryColors.ink} />
                  : <Check size={22} color={summaryColors.ink} />}
              </Pressable>
              <Pressable onPress={closeTotalEditor} disabled={savingTotal} accessibilityRole="button" accessibilityLabel="총 예산 편집 취소"><X size={22} color={summaryColors.label} /></Pressable>
            </View>
          ) : (
            <Pressable style={s.totalRow} onPress={openTotalEdit} accessibilityRole="button" accessibilityLabel="총 예산 수정">
              <Text style={s.totalValue}>{totalBudget > 0 ? formatWon(totalBudget) : "설정해주세요"}</Text>
              <Edit3 size={16} color={summaryColors.label} />
            </Pressable>
          )}
          {totalBudget > 0 && (
            <View style={s.progSection}>
              <View style={s.progBar}>
                <Animated.View style={[s.progFill, { width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }), backgroundColor: remaining >= 0 ? colors.rose[500] : summaryColors.danger }]} />
              </View>
              <View style={s.progLabels}>
                <Text style={s.progLabel}>기록 지출 {formatWon(totalSpent)}</Text>
                <Text style={[s.progLabel, remaining < 0 && s.summaryDanger]}>잔여 {formatWon(Math.abs(remaining))}{remaining < 0 ? " 초과" : ""}</Text>
              </View>
            </View>
          )}

          {/* 두 번째 줄 — 배정·기록 지출·잔여. 예전에는 요약 밖의 흰 카드 세 장이었고
              기록 지출은 장미 `#A77B74`, 초과는 `#EF4444` 로 흰 바탕 기준도 못 넘었다. */}
          <View style={s.sumRow}>
            <View style={s.sumCard}><Wallet size={16} color={summaryColors.label} /><Text style={s.sumLabel}>배정</Text><Text style={s.sumVal}>{formatWon(allocatedBudget)}</Text></View>
            <View style={[s.sumCard, s.sumCardDivided]}><TrendingDown size={16} color={summaryColors.label} /><Text style={s.sumLabel}>기록 지출</Text><Text style={s.sumVal}>{formatWon(totalSpent)}</Text></View>
            <View style={[s.sumCard, s.sumCardDivided]}>
              <TrendingUp size={16} color={totalBudget > 0 && remaining < 0 ? summaryColors.danger : summaryColors.label} />
              {/* 색만으로 초과를 말하지 않는다 — 이름도 "초과"로 바뀐다. */}
              <Text style={[s.sumLabel, totalBudget > 0 && remaining < 0 && s.summaryDanger]}>{totalBudget > 0 && remaining < 0 ? "초과" : "잔여"}</Text>
              <Text style={[s.sumVal, totalBudget > 0 && remaining < 0 && s.summaryDanger]}>{totalBudget > 0 ? formatWon(Math.abs(remaining)) : "계산 전"}</Text>
            </View>
          </View>
          <Text style={s.budgetEvidenceNote}>
            직접 입력하거나 계약 금액으로 확인된 예산만 합산해요. 기록 지출은 결제 완료 여부와 별도예요.
          </Text>
        </FeatureSummarySurface>

        <Surface style={s.riskPanel}>
          <View style={s.riskHeader}>
            <View>
              <Text style={s.riskEyebrow}>입력값 확인</Text>
              <Text style={s.riskTitle}>지금 확인할 예산 항목</Text>
            </View>
            <AlertTriangle
              size={18}
              color={budgetStatus.tone === "danger" ? colors.danger : colors.gold.DEFAULT}
            />
          </View>

          {budgetRisks.length > 0 ? (
            budgetRisks.map((risk) => (
              <Pressable
                key={risk.id}
                style={({ pressed }) => [
                  s.riskRow,
                  pressed && risk.categoryKey && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => {
                  if (risk.categoryKey) openEdit(risk.categoryKey);
                }}
                disabled={!risk.categoryKey}
              >
                <View style={[s.riskDot, s[`riskDot_${risk.tone}`]]} />
                <View style={s.riskCopy}>
                  <Text style={s.riskRowTitle}>{risk.title}</Text>
                  <Text style={s.riskRowDetail}>{risk.detail}</Text>
                </View>
                <StatusPill
                  label={risk.tone === "danger" ? "초과" : "확인"}
                  tone={risk.tone}
                />
              </Pressable>
            ))
          ) : (
            <View style={s.safeBudgetBox}>
              <Check size={18} color={colors.rose[500]} />
              <Text style={s.safeBudgetTitle}>입력한 금액에서 초과를 찾지 못했어요</Text>
              <Text style={s.safeBudgetText}>
                아직 입력하지 않은 금액과 계약서에 적히지 않은 추가 비용은 이 결과에 포함되지 않아요.
              </Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [s.marketLink, pressed && { opacity: 0.7 }]}
            onPress={() => router.push("/market-prices")}
          >
            <Text style={s.marketLinkText}>검수된 공시가 확인하기</Text>
            <TrendingUp size={14} color={colors.rose[500]} />
          </Pressable>
        </Surface>

        {legacyReviewItems.length > 0 && (
          <Surface style={s.legacyReviewCard}>
            <Text style={s.legacyReviewTitle}>용도 미확인 이전 금액</Text>
            <Text style={s.legacyReviewCopy}>
              이전 버전 값은 배정 예산인지 실제 기록인지 확인할 수 없어 예산·기록 지출 합계에서 제외했어요.
            </Text>
            {legacyReviewItems.map((item) => (
              <Text key={item.key} style={s.legacyReviewItem}>
                {item.label} {item.amount === null ? "금액 형식 확인 필요" : formatWon(item.amount)}
              </Text>
            ))}
          </Surface>
        )}

        {/* 항목별 비중. 위 카드가 "얼마" 를 답하고 이 도넛이 "어디에" 를 답한다.
            조각이 하나도 없으면 컴포넌트가 스스로 null 을 낸다. */}
        <BudgetShareChart slices={shareSlices} basis={shareBasis} />

        {/* 분담 현황 */}
        {totalSpent > 0 && (
          <View style={s.payerSection}>
            <Text style={s.payerTitle}>분담 현황</Text>
            {/* 양측을 먼저 보여주고 네 칸으로 편다. 네 칸만 있으면 "우리 쪽이 얼마" 를
                눈으로 더해야 나오는데, 그게 이 화면에서 제일 자주 묻는 질문이다. */}
            <BudgetSideSplit
              brideSide={payerSides.brideSide}
              groomSide={payerSides.groomSide}
              shared={payerSides.shared}
            />
            <View style={s.payerGrid}>
              {PAYER_OPTIONS.map((opt) => {
                const amount = payerSummary[opt.value] ?? 0;
                const pct = totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0;
                return (
                  <View key={opt.value} style={s.payerCard}>
                    <Text style={s.payerLabel}>{opt.label}</Text>
                    <Text style={s.payerAmount}>{formatWon(amount)}</Text>
                    {pct > 0 && <Text style={s.payerPct}>{pct}%</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* 카테고리 목록 — "안 해요"로 고르고 금액이 없는 기본 항목은 행으로 두지 않는다. */}
        {budgetRows.map((cat) => {
          const b = getCatBudget(cat.key), sp = getCatSpent(cat.key), st = getCatStatus(cat.key);
          const pct = b > 0 ? Math.min(100, Math.round((sp / b) * 100)) : 0;
          const hasHidden = !!HIDDEN_COSTS[cat.key];
          const payerInfo = PAYER_OPTIONS.find((p) => p.value === getCatPayer(cat.key));
          return (
            <Pressable key={cat.key} style={({ pressed }) => [s.catCard, pressed && { transform: [{ scale: 0.98 }] }]} onPress={() => openEdit(cat.key)}>
              <View style={s.catHead}>
                <View style={s.catLabelRow}>
                  <Text style={s.catLabel}>{cat.label}</Text>
                  {hasHidden && (
                    <Pressable
                      onPress={(e) => { e.stopPropagation?.(); showHiddenCostAlert(cat.key); }}
                      hitSlop={8}
                      style={s.hiddenCostBtn}
                    >
                      <AlertTriangle size={12} color="#D97706" />
                    </Pressable>
                  )}
                </View>
                <View style={s.catHeadRight}>
                  {payerInfo && payerInfo.value !== "couple" && (
                    <View style={s.payerBadge}>
                      <Text style={s.payerBadgeText}>{payerInfo.label}</Text>
                    </View>
                  )}
                  <View style={[s.badge, st === "completed" && s.badgeDone, st === "in_progress" && s.badgeProg, st === "not_applicable" && s.badgeSkipped]}>
                    <Text style={[s.badgeText, st === "completed" && s.badgeTextDone, st === "in_progress" && s.badgeTextProg]}>{PREPARATION_PROGRESS_STATUS_LABELS[st]}</Text>
                  </View>
                </View>
              </View>
              {b > 0 ? (
                <View style={s.catBar}><View style={[s.catFill, { width: `${pct}%`, backgroundColor: sp > b ? colors.danger : colors.rose[500] }]} /></View>
              ) : (
                <Text style={s.categoryBudgetPending}>예산 입력 전</Text>
              )}
              <View style={s.catFoot}>
                <Text style={s.catSpent}>기록 지출 {formatWon(sp)}</Text>
                <Text style={s.catBudget}>{b > 0 ? `/ 예산 ${formatWon(b)}` : "예산 미입력"}</Text>
                {b > 0 && <Text style={s.catPct}>{pct}%</Text>}
              </View>
            </Pressable>
          );
        })}
        <Text style={s.hint}>카테고리를 탭하면 예산/기록 지출을 수정할 수 있어요</Text>
      </ScrollView>

      {/* 편집 모달 */}
      <Modal visible={!!editingKey} animationType="slide" transparent onRequestClose={closeCategoryEditor}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.modalOv}>
          <View style={s.modalCon}>
            <View style={s.modalHandle} />
            <View style={s.modalHead}><Text style={s.modalTitle}>{budgetCategories.find((category) => category.key === editingKey)?.label ?? ""} 수정</Text><Pressable onPress={closeCategoryEditor} disabled={saving} accessibilityRole="button" accessibilityLabel="카테고리 예산 편집 닫기"><X size={24} color={colors.textTertiary} /></Pressable></View>
            <Text style={s.fLabel}>예산 (만원)</Text>
            <TextInput style={s.fInput} value={budgetInput} onChangeText={setBudgetInput} keyboardType="decimal-pad" editable={!saving} maxLength={11} accessibilityLabel="카테고리 예산 만원 단위 입력" placeholder="0" placeholderTextColor={colors.taupe[400]} />
            <Text style={s.fLabel}>기록 지출 (만원 · 결제 확인과 별도)</Text>
            <TextInput style={s.fInput} value={spentInput} onChangeText={setSpentInput} keyboardType="decimal-pad" editable={!saving} maxLength={11} accessibilityLabel="카테고리 기록 지출 만원 단위 입력" placeholder="0" placeholderTextColor={colors.taupe[400]} />
            <Text style={s.fLabel}>분담</Text>
            <View style={s.payerRow}>
              {PAYER_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[s.payerOption, payerInput === opt.value && s.payerOptionActive]}
                  onPress={() => setPayerInput(opt.value)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityState={{ selected: payerInput === opt.value, disabled: saving }}
                >
                  <Text style={[s.payerOptionLabel, payerInput === opt.value && s.payerOptionLabelActive]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
            {editingKey && HIDDEN_COSTS[editingKey] && (
              <View style={s.hiddenCostBanner}>
                <AlertTriangle size={14} color="#D97706" />
                <View style={s.hiddenCostBannerText}>
                  <Text style={s.hiddenCostTitle}>포함·별도 항목 확인</Text>
                  <Text style={s.hiddenCostDesc}>{HIDDEN_COSTS[editingKey].warning}</Text>
                  <Text style={s.hiddenCostExtra}>{HIDDEN_COSTS[editingKey].guidance}</Text>
                </View>
              </View>
            )}
            <Pressable style={s.saveBtn} onPress={saveCategoryEdit} disabled={saving} accessibilityRole="button" accessibilityLabel="카테고리 예산 변경 요청" accessibilityState={{ disabled: saving, busy: saving }}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={s.saveTxt}>변경 요청</Text>}</Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  pendingApprovalCard: { marginBottom: 16, padding: 16, borderWidth: 1, borderColor: colors.gold.DEFAULT, backgroundColor: colors.ivory[100] },
  pendingApprovalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  pendingApprovalTitle: { flex: 1, fontSize: 15, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  pendingApprovalSummary: { marginTop: 10, fontSize: 13, fontFamily: "NotoSansKR_500Medium", color: colors.noir[800] },
  pendingApprovalDescription: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  pendingApprovalReference: { marginTop: 8, fontSize: 11, color: colors.textTertiary },
  pendingApprovalRefresh: { alignSelf: "flex-start", marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.noir[800] },
  pendingApprovalRefreshText: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: "#FFF" },
  totalCard: { padding: 20, marginBottom: 16 },
  totalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  totalLabel: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: summaryColors.label },
  totalRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  totalValue: { fontSize: 32, fontFamily: "CormorantGaramond_600SemiBold", color: summaryColors.ink },
  editRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  totalEditInput: { flex: 1, fontSize: 24, fontFamily: "CormorantGaramond_600SemiBold", color: summaryColors.ink, borderBottomWidth: 1, borderBottomColor: summaryColors.accent, paddingVertical: 4 },
  totalUnit: { fontSize: 14, color: summaryColors.label },
  progSection: { marginTop: 16 },
  progBar: { height: 6, backgroundColor: summaryColors.track, borderRadius: 3, overflow: "hidden" },
  progFill: { height: "100%", borderRadius: 3 },
  progLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  progLabel: { fontSize: 12, color: summaryColors.label },
  summaryDanger: { color: summaryColors.danger },
  legacyReviewCard: { marginBottom: 16, padding: 16, borderWidth: 1, borderColor: "#D8C7BB", backgroundColor: "#FFF9F2" },
  legacyReviewTitle: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  legacyReviewCopy: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  legacyReviewItem: { marginTop: 6, fontSize: 12, fontFamily: "NotoSansKR_500Medium", color: colors.noir[800] },
  riskPanel: { paddingVertical: 18, marginBottom: 16 },
  riskHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  riskEyebrow: { fontSize: 11, fontFamily: "NotoSansKR_600SemiBold", color: colors.textTertiary, marginBottom: 2 },
  riskTitle: { fontSize: 17, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  riskRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  riskDot: { width: 4, height: 36, borderRadius: 2 },
  riskDot_neutral: { backgroundColor: colors.taupe[400] },
  riskDot_rose: { backgroundColor: colors.rose[500] },
  riskDot_warning: { backgroundColor: colors.gold.DEFAULT },
  riskDot_danger: { backgroundColor: colors.danger },
  riskCopy: { flex: 1, gap: 2 },
  riskRowTitle: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  riskRowDetail: { fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary, lineHeight: 18 },
  safeBudgetBox: { alignItems: "center", paddingVertical: 18, gap: 6, borderTopWidth: 1, borderTopColor: colors.border },
  safeBudgetTitle: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  safeBudgetText: { fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary, textAlign: "center", lineHeight: 18 },
  marketLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  marketLinkText: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.rose[500] },
  // 요약 면 안의 두 번째 줄. 칸을 따로 칠하지 않고 선으로만 나눈다 — 면 안에 또 카드를 두면
  // 요약과 내용 카드의 구분이 다시 흐려진다.
  sumRow: { flexDirection: "row", marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: summaryColors.line },
  sumCard: { flex: 1, alignItems: "center", gap: 6, paddingHorizontal: 4 },
  sumCardDivided: { borderLeftWidth: 1, borderLeftColor: summaryColors.line },
  sumLabel: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: summaryColors.label },
  sumVal: { fontSize: 15, fontFamily: "CormorantGaramond_600SemiBold", color: summaryColors.ink },
  budgetEvidenceNote: { marginTop: 12, fontSize: 12, lineHeight: 18, color: summaryColors.label, textAlign: "center" },
  catCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 10 },
  catHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  catLabel: { fontSize: 15, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  // 상태 칩. 색은 웹 예산 칩(완료 세이지 · 준비 중 장미 · 아직 베이지 · 안 해요 점선)을 따르고,
  // 글자는 흰 카드 위 칩 바탕에서 4.5:1 이상인 진한 단계를 쓴다.
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: "transparent", backgroundColor: colors.ivory[200] },
  badgeDone: { backgroundColor: colors.htmlWorkspace.sagePale },
  badgeProg: { backgroundColor: colors.rose.pale },
  badgeSkipped: { backgroundColor: colors.surface, borderColor: colors.border, borderStyle: "dashed" },
  badgeText: { fontSize: 11, fontFamily: "NotoSansKR_600SemiBold", color: colors.textSecondary },
  badgeTextDone: { color: "#33473A" },
  badgeTextProg: { color: colors.rose[700] },
  catBar: { height: 4, backgroundColor: colors.ivory[200], borderRadius: 2, overflow: "hidden", marginBottom: 8 },
  catFill: { height: "100%", borderRadius: 2 },
  categoryBudgetPending: { marginBottom: 8, fontSize: 12, color: colors.textTertiary },
  catFoot: { flexDirection: "row", alignItems: "center", gap: 4 },
  catSpent: { fontSize: 13, fontFamily: "NotoSansKR_500Medium", color: colors.noir[800] },
  catBudget: { fontSize: 12, color: colors.textTertiary, flex: 1 },
  catPct: { fontSize: 13, fontFamily: "CormorantGaramond_600SemiBold", color: colors.rose[500] },
  hint: { fontSize: 12, color: colors.textTertiary, textAlign: "center", marginTop: 12 },
  modalOv: { flex: 1, backgroundColor: "rgba(37,26,24,0.4)", justifyContent: "flex-end" },
  modalCon: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 16 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontFamily: "NotoSerifKR_500Medium", color: colors.noir[800] },
  fLabel: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.textSecondary, marginBottom: 8, marginTop: 16 },
  fInput: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "CormorantGaramond_400Regular", color: colors.noir[800] },
  saveBtn: { backgroundColor: colors.noir[800], borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  saveTxt: { fontSize: 16, fontFamily: "NotoSansKR_600SemiBold", color: "#FFF" },

  // 숨겨진 비용 경고
  catLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  catHeadRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  hiddenCostBtn: { width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(217,119,6,0.1)", alignItems: "center", justifyContent: "center" },
  hiddenCostBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "rgba(217,119,6,0.08)", borderRadius: 12, padding: 12, marginTop: 16 },
  hiddenCostBannerText: { flex: 1 },
  hiddenCostTitle: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: "#D97706", marginBottom: 2 },
  hiddenCostDesc: { fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary, lineHeight: 18 },
  hiddenCostExtra: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: "#D97706", marginTop: 4 },

  // 분담(Payer) 선택
  payerRow: { flexDirection: "row", gap: 8 },
  payerOption: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: colors.ivory[200], borderWidth: 1, borderColor: "transparent" },
  payerOptionActive: { backgroundColor: "rgba(196,150,126,0.12)", borderColor: colors.rose[500] },
  payerOptionEmoji: { fontSize: 16, marginBottom: 2 },
  payerOptionLabel: { fontSize: 11, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },
  payerOptionLabelActive: { color: colors.rose[500], fontFamily: "NotoSansKR_600SemiBold" },
  payerBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(196,150,126,0.1)" },
  payerBadgeText: { fontSize: 10, fontFamily: "NotoSansKR_400Regular", color: colors.rose[500] },

  // 분담 현황 섹션
  payerSection: { marginBottom: 20 },
  payerTitle: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800], marginBottom: 10 },
  payerGrid: { flexDirection: "row", gap: 8 },
  payerCard: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 10, alignItems: "center", gap: 2 },
  payerEmoji: { fontSize: 16 },
  payerLabel: { fontSize: 10, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },
  payerAmount: { fontSize: 13, fontFamily: "CormorantGaramond_600SemiBold", color: colors.noir[800] },
  payerPct: { fontSize: 10, fontFamily: "NotoSansKR_400Regular", color: colors.rose[500] },
});
