// 예산 관리 — 웹과 동일한 wedding_journeys.progress 기반
// budget/spent만 합산한다. legacy cost는 용도 확인 전까지 검토값으로만 표시한다.
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { TrendingDown, TrendingUp, Wallet, Edit3, Check, X, AlertTriangle } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  CHECKLIST_MAP,
  PLANNING_CATEGORY_LABELS,
  type PlanningCategoryKey,
} from "@hanbang/shared/constants";
import { getEffectivePlanningChecklistStatus } from "@hanbang/shared/planning-checklist";
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
import { AppHeader, LoadingState, StatusPill, Surface } from "@/components/ui/AppUI";
import ErrorRetry from "@/components/ErrorRetry";

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
  "meeting", "venue", "studio", "dress", "makeup", "snap", "ring", "yedan",
  "hanbok", "shoes", "bouquet", "honeymoon", "houseware", "housing",
  "invitation", "gift", "mc", "ham", "pyebaek", "reserve",
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

function formatWon(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만원`;
  if (n > 0) return `${n.toLocaleString()}원`;
  return "—";
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
  const [progress, setProgress] = useState<Record<string, ProgressItem>>({});
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
    setProgress(toBudgetProgress(snapshot.progress));

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
      return () => {
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

    const channel = supabase.channel(`budget:${coupleId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "wedding_journeys",
        filter: `couple_id=eq.${coupleId}`,
      }, () => {
        void loadData();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
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
  function getCatStatus(key: string): string {
    const template = CHECKLIST_MAP[key];
    const s = template
      ? getEffectivePlanningChecklistStatus(template.items, progress[key] as never)
      : progress[key]?.status ?? "not_started";
    return s === "completed" ? "완료" : s === "in_progress" ? "진행중" : "예정";
  }
  function getCatPayer(key: string): PayerType {
    return progress[key]?.payer ?? "couple";
  }

  const budgetCategories = listBudgetCategories({
    fixedCategories: BUDGET_CATEGORIES,
    progress,
  });

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
  const remaining = totalBudget - totalSpent;
  const spentPct = totalBudget > 0 ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;
  const allocatedBudget = budgetCategories.reduce((sum, category) => {
    return sum + getCatBudget(category.key);
  }, 0);
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
    .filter((cat) => HIDDEN_COSTS[cat.key] && getCatStatus(cat.key) !== "완료")
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
    ...(remaining < 0
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
        body: JSON.stringify(body),
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
    setBudgetInput(getCatBudget(key) > 0 ? String(Math.round(getCatBudget(key) / 10000)) : "");
    setSpentInput(getCatSpent(key) > 0 ? String(Math.round(getCatSpent(key) / 10000)) : "");
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
    setTotalInput(totalBudget > 0 ? String(Math.round(totalBudget / 10000)) : "");
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

        {/* 총 예산 */}
        <View style={s.totalCard}>
          <View style={s.totalTop}>
            <Text style={s.totalLabel}>예산 운영 상태</Text>
            <StatusPill label={budgetStatus.label} tone={budgetStatus.tone} />
          </View>
          {editingTotal ? (
            <View style={s.editRow}>
              <TextInput style={s.totalEditInput} value={totalInput} onChangeText={setTotalInput} keyboardType="number-pad" autoFocus editable={!savingTotal} maxLength={6} accessibilityLabel="총 예산 만원 단위 입력" placeholder="0" placeholderTextColor={colors.taupe[400]} />
              <Text style={s.totalUnit}>만원</Text>
              <Pressable onPress={saveTotalBudget} disabled={savingTotal} accessibilityRole="button" accessibilityLabel="총 예산 변경 요청" accessibilityState={{ disabled: savingTotal, busy: savingTotal }}>
                {savingTotal
                  ? <ActivityIndicator size="small" color={colors.rose[500]} />
                  : <Check size={22} color={colors.rose[500]} />}
              </Pressable>
              <Pressable onPress={closeTotalEditor} disabled={savingTotal} accessibilityRole="button" accessibilityLabel="총 예산 편집 취소"><X size={22} color={colors.taupe[400]} /></Pressable>
            </View>
          ) : (
            <Pressable style={s.totalRow} onPress={openTotalEdit}>
              <Text style={s.totalValue}>{totalBudget > 0 ? formatWon(totalBudget) : "설정해주세요"}</Text>
              <Edit3 size={16} color={colors.taupe[400]} />
            </Pressable>
          )}
          {totalBudget > 0 && (
            <View style={s.progSection}>
              <View style={s.progBar}>
                <Animated.View style={[s.progFill, { width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }), backgroundColor: remaining >= 0 ? colors.rose[500] : "#EF4444" }]} />
              </View>
              <View style={s.progLabels}>
                <Text style={s.progLabel}>기록 지출 {formatWon(totalSpent)}</Text>
                <Text style={[s.progLabel, remaining < 0 && { color: "#EF4444" }]}>잔여 {formatWon(Math.abs(remaining))}{remaining < 0 ? " 초과" : ""}</Text>
              </View>
            </View>
          )}
        </View>

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

        {/* 요약 */}
        <View style={s.sumRow}>
          <View style={s.sumCard}><Wallet size={16} color={colors.textTertiary} /><Text style={s.sumLabel}>배정</Text><Text style={s.sumVal}>{formatWon(allocatedBudget)}</Text></View>
          <View style={s.sumCard}><TrendingDown size={16} color={colors.rose[500]} /><Text style={s.sumLabel}>기록 지출</Text><Text style={[s.sumVal, { color: colors.rose[500] }]}>{formatWon(totalSpent)}</Text></View>
          <View style={s.sumCard}><TrendingUp size={16} color={remaining >= 0 ? colors.textSecondary : "#EF4444"} /><Text style={s.sumLabel}>잔여</Text><Text style={[s.sumVal, remaining < 0 && { color: "#EF4444" }]}>{formatWon(Math.abs(remaining))}</Text></View>
        </View>
        <Text style={s.budgetEvidenceNote}>
          직접 입력하거나 계약 금액으로 확인된 예산만 합산해요. 기록 지출은 결제 완료 여부와 별도예요.
        </Text>

        {/* 분담 현황 */}
        {totalSpent > 0 && (
          <View style={s.payerSection}>
            <Text style={s.payerTitle}>분담 현황</Text>
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

        {/* 카테고리 목록 */}
        {budgetCategories.map((cat) => {
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
                  <View style={[s.badge, st === "완료" && s.badgeDone, st === "진행중" && s.badgeProg]}>
                    <Text style={[s.badgeText, st === "완료" && s.badgeTextDone, st === "진행중" && s.badgeTextProg]}>{st}</Text>
                  </View>
                </View>
              </View>
              {b > 0 ? (
                <View style={s.catBar}><View style={[s.catFill, { width: `${pct}%`, backgroundColor: sp > b ? "#EF4444" : colors.rose[500] }]} /></View>
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
            <TextInput style={s.fInput} value={budgetInput} onChangeText={setBudgetInput} keyboardType="number-pad" editable={!saving} maxLength={6} accessibilityLabel="카테고리 예산 만원 단위 입력" placeholder="0" placeholderTextColor={colors.taupe[400]} />
            <Text style={s.fLabel}>기록 지출 (만원 · 결제 확인과 별도)</Text>
            <TextInput style={s.fInput} value={spentInput} onChangeText={setSpentInput} keyboardType="number-pad" editable={!saving} maxLength={6} accessibilityLabel="카테고리 기록 지출 만원 단위 입력" placeholder="0" placeholderTextColor={colors.taupe[400]} />
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
  totalCard: { backgroundColor: colors.noir[800], borderRadius: 24, padding: 24, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 4 },
  totalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  totalLabel: { fontSize: 13, fontFamily: "NotoSansKR_400Regular", color: colors.taupe[400] },
  totalRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  totalValue: { fontSize: 32, fontFamily: "CormorantGaramond_600SemiBold", color: "#FFFFFF" },
  editRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  totalEditInput: { flex: 1, fontSize: 24, fontFamily: "CormorantGaramond_600SemiBold", color: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: colors.rose[500], paddingVertical: 4 },
  totalUnit: { fontSize: 14, color: colors.taupe[400] },
  progSection: { marginTop: 16 },
  progBar: { height: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 3, overflow: "hidden" },
  progFill: { height: "100%", borderRadius: 3 },
  progLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  progLabel: { fontSize: 12, color: colors.taupe[400] },
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
  sumRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  sumCard: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 14, alignItems: "center", gap: 6 },
  sumLabel: { fontSize: 11, color: colors.textTertiary },
  sumVal: { fontSize: 15, fontFamily: "CormorantGaramond_600SemiBold", color: colors.noir[800] },
  budgetEvidenceNote: { marginTop: -10, marginBottom: 20, fontSize: 12, lineHeight: 18, color: colors.textTertiary, textAlign: "center" },
  catCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 10 },
  catHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  catLabel: { fontSize: 15, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.ivory[200] },
  badgeDone: { backgroundColor: "rgba(196,150,126,0.15)" },
  badgeProg: { backgroundColor: "rgba(201,169,110,0.15)" },
  badgeText: { fontSize: 11, color: colors.textTertiary },
  badgeTextDone: { color: colors.rose[500] },
  badgeTextProg: { color: colors.gold.DEFAULT },
  catBar: { height: 4, backgroundColor: colors.ivory[200], borderRadius: 2, overflow: "hidden", marginBottom: 8 },
  catFill: { height: "100%", borderRadius: 2 },
  categoryBudgetPending: { marginBottom: 8, fontSize: 12, color: colors.textTertiary },
  catFoot: { flexDirection: "row", alignItems: "center", gap: 4 },
  catSpent: { fontSize: 13, fontFamily: "NotoSansKR_500Medium", color: colors.noir[800] },
  catBudget: { fontSize: 12, color: colors.textTertiary, flex: 1 },
  catPct: { fontSize: 13, fontFamily: "CormorantGaramond_600SemiBold", color: colors.rose[500] },
  hint: { fontSize: 12, color: colors.textTertiary, textAlign: "center", marginTop: 12 },
  modalOv: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
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
