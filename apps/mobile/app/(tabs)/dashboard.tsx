// 홈 — 우리의 결혼식, 오늘의 한 가지, 준비 서비스 (Supabase 실데이터)
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { colors } from "@hanbang/design-tokens";
import { buildAmoraPreparationOverview } from "@hanbang/shared/amora-preparation-map";
import { supabase } from "@/lib/supabase";
import { apiFetchForExpectedUser } from "@/lib/api";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import {
  DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT,
  formatLocalDateKey,
  selectDashboardOpenAction,
  type DashboardOpenAction,
} from "@/lib/dashboardExperience.mjs";
import { resolveActionReceiptHomeHandoff } from "@/lib/actionReceiptHomeHandoff.mjs";
import { isActiveScheduleEvent } from "@/lib/scheduleMutation.mjs";
import {
  loadOwnerAmoraPersonalization,
  type AmoraPersonalizationPreferences,
} from "@/lib/amoraPersonalization.mjs";
import { loadOwnerAmoraActionOutcomeFeedback } from "@/lib/amoraActionFeedback.mjs";
import { loadOwnerAmoraCoreCriterion } from "@/lib/amoraCoreCriterion.mjs";
import { loadOwnerAmoraCoupleCriterion } from "@/lib/amoraCoupleCriterion.mjs";
import ErrorRetry from "@/components/ErrorRetry";
import { EmptyState, PrimaryButton } from "@/components/ui/AppUI";
import AmoraActionFollowUpV2 from "@/components/dashboard/AmoraActionFollowUpV2";
import AmoraMediationOutcomeFollowUp from "@/components/dashboard/AmoraMediationOutcomeFollowUp";
import TodayOneCareCard from "@/components/dashboard/TodayOneCareCard";
import WeddingHomeExperience, {
  type WeddingHomeData,
} from "@/components/dashboard/WeddingHomeExperience";

interface UrgentTask {
  categoryKey: string;
  categoryLabel: string;
  ddayDeadline: number;
  remainingDays: number;
  urgency: "overdue" | "soon" | "ontrack";
}

interface PartnerActivity {
  partnerName: string;
  recentCategories: string[];
}

interface BookingOutcomeTask {
  id: string;
  vendorName: string;
  categoryLabel: string;
  bookingDate: string;
  isPast: boolean;
}

interface DashboardData extends WeddingHomeData {
  totalBudget: number;
  progress: Record<string, unknown>;
  urgentTasks: UrgentTask[];
  bookingOutcomeTasks: BookingOutcomeTask[];
  partnerActivity: PartnerActivity | null;
  personalization: Readonly<AmoraPersonalizationPreferences> | null;
}

async function loadPreferredOpenAmoraAction(
  coupleId: string,
): Promise<DashboardOpenAction | null> {
  const { data, error } = await supabase
    .from("amora_actions")
    .select("id, couple_id, title, description, due_date, category_key, priority, source, status, follow_up_revision, created_at")
    .eq("couple_id", coupleId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT);
  if (error) return null;
  return selectDashboardOpenAction(data, coupleId, formatLocalDateKey());
}

async function readCurrentOpenAmoraAction({
  actionId,
  coupleId,
}: {
  actionId: string;
  coupleId: string;
}) {
  const { data, error } = await supabase
    .from("amora_actions")
    .select("id, couple_id, title, description, due_date, category_key, priority, source, status, follow_up_revision, created_at")
    .eq("id", actionId)
    .eq("couple_id", coupleId)
    .eq("status", "open")
    .maybeSingle();
  return error
    ? { ok: false as const }
    : { ok: true as const, value: data };
}

export interface DashboardLoadTicket {
  sessionGeneration: number;
  loadGeneration: number;
}

export interface DashboardIdentity {
  ownerUserId: string;
  coupleId: string | null;
}

export interface DashboardActionReceiptLease {
  token: number;
  identity: DashboardIdentity;
  phase: "provisional" | "confirmed";
}

export function createDashboardLoadCoordinator() {
  let sessionGeneration = 0;
  let loadGeneration = 0;
  let nextActionReceiptLeaseToken = 0;
  let pinnedActionReceiptLease: DashboardActionReceiptLease | null = null;
  let deferredReceiptReload = false;

  const isCurrent = (ticket: DashboardLoadTicket) =>
    ticket.sessionGeneration === sessionGeneration
    && ticket.loadGeneration === loadGeneration;
  const isSameIdentity = (
    left: DashboardIdentity | null,
    right: DashboardIdentity | null,
  ) => left !== null
    && right !== null
    && left.ownerUserId === right.ownerUserId
    && left.coupleId === right.coupleId;

  return {
    beginLoad(): DashboardLoadTicket {
      loadGeneration += 1;
      return { sessionGeneration, loadGeneration };
    },
    invalidateSession(): void {
      sessionGeneration += 1;
      loadGeneration += 1;
      pinnedActionReceiptLease = null;
      deferredReceiptReload = false;
    },
    currentSessionGeneration(): number {
      return sessionGeneration;
    },
    isCurrent,
    isSessionCurrent(expectedSessionGeneration: number): boolean {
      return expectedSessionGeneration === sessionGeneration;
    },
    beginActionReceiptLease(
      identity: DashboardIdentity,
      expectedSessionGeneration: number,
    ): number | null {
      if (expectedSessionGeneration !== sessionGeneration) return null;
      if (!identity.ownerUserId || !identity.coupleId) return null;
      if (pinnedActionReceiptLease) return null;
      nextActionReceiptLeaseToken += 1;
      pinnedActionReceiptLease = {
        token: nextActionReceiptLeaseToken,
        identity: { ...identity },
        phase: "provisional",
      };
      // An outcome can retire or revise the action before its canonical
      // receipt is reread. Stop every older home load from unmounting it.
      loadGeneration += 1;
      deferredReceiptReload = true;
      return pinnedActionReceiptLease.token;
    },
    confirmActionReceiptLease(
      identity: DashboardIdentity,
      token: number,
    ): boolean {
      if (
        pinnedActionReceiptLease?.token !== token
        || !isSameIdentity(pinnedActionReceiptLease.identity, identity)
      ) return false;
      pinnedActionReceiptLease.phase = "confirmed";
      return true;
    },
    getPinnedActionReceiptLease(): DashboardActionReceiptLease | null {
      return pinnedActionReceiptLease
        ? {
            token: pinnedActionReceiptLease.token,
            identity: { ...pinnedActionReceiptLease.identity },
            phase: pinnedActionReceiptLease.phase,
          }
        : null;
    },
    hasPinnedActionReceipt(identity?: DashboardIdentity): boolean {
      if (!pinnedActionReceiptLease) return false;
      return identity === undefined
        || isSameIdentity(pinnedActionReceiptLease.identity, identity);
    },
    deferReloadForPinnedReceipt(identity?: DashboardIdentity): boolean {
      if (!pinnedActionReceiptLease) return false;
      if (
        identity !== undefined
        && !isSameIdentity(pinnedActionReceiptLease.identity, identity)
      ) return false;
      deferredReceiptReload = true;
      return true;
    },
    releasePinnedActionReceipt(identity: DashboardIdentity, token: number): {
      released: boolean;
      hadDeferredReload: boolean;
    } {
      if (
        pinnedActionReceiptLease?.token !== token
        || !isSameIdentity(pinnedActionReceiptLease.identity, identity)
      ) {
        return { released: false, hadDeferredReload: false };
      }
      const hadDeferredReload = deferredReceiptReload;
      pinnedActionReceiptLease = null;
      deferredReceiptReload = false;
      return { released: true, hadDeferredReload };
    },
    async verifyCurrentOwner(
      ticket: DashboardLoadTicket,
      expectedOwnerUserId: string,
      readCurrentOwnerUserId: () => Promise<string | null>,
    ): Promise<boolean> {
      if (!isCurrent(ticket)) return false;
      const currentOwnerUserId = await readCurrentOwnerUserId();
      return isCurrent(ticket) && currentOwnerUserId === expectedOwnerUserId;
    },
    async verifyCurrentIdentity(
      ticket: DashboardLoadTicket,
      expectedIdentity: DashboardIdentity,
      readCurrentIdentity: () => Promise<DashboardIdentity | null>,
    ): Promise<boolean> {
      if (!isCurrent(ticket)) return false;
      const currentIdentity = await readCurrentIdentity();
      return isCurrent(ticket)
        && currentIdentity?.ownerUserId === expectedIdentity.ownerUserId
        && currentIdentity?.coupleId === expectedIdentity.coupleId;
    },
    mergeForOwner<T extends { ownerUserId: string }>(
      ticket: DashboardLoadTicket,
      expectedOwnerUserId: string,
      current: T | null,
      patch: Partial<T>,
    ): T | null {
      if (
        !isCurrent(ticket)
        || !current
        || current.ownerUserId !== expectedOwnerUserId
      ) return current;
      return { ...current, ...patch };
    },
    mergeForIdentity<T extends DashboardIdentity>(
      ticket: DashboardLoadTicket,
      expectedIdentity: DashboardIdentity,
      current: T | null,
      patch: Partial<T>,
    ): T | null {
      if (
        !isCurrent(ticket)
        || !current
        || current.ownerUserId !== expectedIdentity.ownerUserId
        || current.coupleId !== expectedIdentity.coupleId
      ) return current;
      return { ...current, ...patch };
    },
  };
}

const CATEGORY_LABEL_BY_KEY = Object.fromEntries(
  CATEGORY_CHECKLISTS.map((category) => [category.key, category.label]),
) as Record<string, string>;

function readAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function parseBookingDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (year && month && day) {
    return new Date(year, month - 1, day);
  }
  return new Date(dateStr);
}

function getTodayStart(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getCategoryLabel(category: unknown): string {
  if (typeof category !== "string" || category.length === 0) {
    return "업체";
  }
  return CATEGORY_LABEL_BY_KEY[category] ?? category;
}

function toSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isOutcomeNeededBooking(
  row: Record<string, unknown>,
  today: Date,
): boolean {
  const status = String(row.status ?? "");
  if (status === "cancelled") return false;

  const actualAmount = readAmount(row.actual_amount);
  if (actualAmount !== null && actualAmount > 0) return false;

  const bookingDate = parseBookingDate(String(row.booking_date ?? ""));
  const isPast = !Number.isNaN(bookingDate.getTime()) && bookingDate < today;
  return status === "completed" || isPast;
}

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const wedding = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(wedding.getTime())) return null;

  const today = getTodayStart();
  return Math.ceil(
    (wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
}

// 결혼일 기준 마감이 지났거나 임박한 미완료 카테고리 TOP 3
function calcUrgentTasks(
  dday: number | null,
  progress: Record<string, unknown>,
): UrgentTask[] {
  if (dday === null || dday <= 0) return [];

  const tasks: UrgentTask[] = [];

  for (const category of CATEGORY_CHECKLISTS) {
    const categoryProgress = progress[category.key] as
      | {
          status?: string;
          checklist?: Array<{ id: string; done: boolean }>;
          [key: string]: unknown;
        }
      | undefined;

    if (categoryProgress?.status === "completed" || categoryProgress?.status === "not_applicable") continue;

    let allDone = false;
    if (
      categoryProgress?.checklist
      && Array.isArray(categoryProgress.checklist)
    ) {
      allDone =
        categoryProgress.checklist.length > 0
        && categoryProgress.checklist.every((item) => item.done);
    } else if (categoryProgress && typeof categoryProgress === "object") {
      const booleanValues = Object.values(categoryProgress).filter(
        (value): value is boolean => typeof value === "boolean",
      );
      allDone =
        booleanValues.length > 0
        && booleanValues.every((value) => value === true);
    }
    if (allDone) continue;

    const remainingDays = dday - category.ddayDeadline;
    const urgency: UrgentTask["urgency"] =
      remainingDays < 0
        ? "overdue"
        : remainingDays <= 14
          ? "soon"
          : "ontrack";

    if (dday > category.ddayStart) continue;

    tasks.push({
      categoryKey: category.key,
      categoryLabel: category.label,
      ddayDeadline: category.ddayDeadline,
      remainingDays,
      urgency,
    });
  }

  const urgencyOrder: Record<UrgentTask["urgency"], number> = {
    overdue: 0,
    soon: 1,
    ontrack: 2,
  };
  tasks.sort((left, right) => {
    const orderDiff =
      urgencyOrder[left.urgency] - urgencyOrder[right.urgency];
    return orderDiff !== 0
      ? orderDiff
      : left.remainingDays - right.remainingDays;
  });

  return tasks.slice(0, 3);
}

async function loadBookingOutcomeTasks(
  coupleId: string,
): Promise<BookingOutcomeTask[]> {
  const todayStart = getTodayStart();
  const todayKey = formatLocalDateKey(todayStart);
  const { data: bookingRows, error } = await supabase
    .from("vendor_bookings")
    .select(
      "id, booking_date, status, actual_amount, vendor:vendors(name, category)",
    )
    .eq("couple_id", coupleId)
    .neq("status", "cancelled")
    .or(`status.eq.completed,booking_date.lt.${todayKey}`)
    .or("actual_amount.is.null,actual_amount.eq.0")
    .order("booking_date", { ascending: false })
    .limit(3);

  if (error) return [];

  return ((bookingRows ?? []) as Array<Record<string, unknown>>)
    .filter((row) => isOutcomeNeededBooking(row, todayStart))
    .map((row) => {
      const vendor = toSingleRelation(
        row.vendor as
          | { name?: unknown; category?: unknown }
          | { name?: unknown; category?: unknown }[]
          | null,
      );
      const bookingDate = String(row.booking_date ?? "");
      const parsedDate = parseBookingDate(bookingDate);
      const isPast =
        !Number.isNaN(parsedDate.getTime()) && parsedDate < todayStart;

      return {
        id: String(row.id ?? ""),
        vendorName:
          typeof vendor?.name === "string" && vendor.name.length > 0
            ? vendor.name
            : "업체 미정",
        categoryLabel: getCategoryLabel(vendor?.category),
        bookingDate,
        isPast,
      };
    })
    .filter((task) => task.id.length > 0)
    .slice(0, 3);
}

async function loadPartnerActivity({
  coupleId,
  userId,
  progress,
}: {
  coupleId: string;
  userId: string;
  progress: Record<string, unknown>;
}): Promise<PartnerActivity | null> {
  const { data: partners, error } = await supabase
    .from("couple_profile_directory")
    .select("name")
    .eq("couple_id", coupleId)
    .neq("id", userId);

  if (error || !partners || partners.length === 0) return null;

  const recentCategories: string[] = [];
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const category of CATEGORY_CHECKLISTS) {
    const categoryProgress = progress[category.key] as
      | {
          updated_by?: string;
          updated_at?: string;
        }
      | undefined;
    if (
      !categoryProgress?.updated_by
      || categoryProgress.updated_by === userId
    ) {
      continue;
    }

    if (!categoryProgress.updated_at) {
      continue;
    }

    const updatedAt = new Date(categoryProgress.updated_at);
    if (!Number.isNaN(updatedAt.getTime()) && updatedAt >= sevenDaysAgo) {
      recentCategories.push(category.label);
    }
  }

  if (recentCategories.length === 0) return null;
  return {
    partnerName: partners[0]?.name ?? "파트너",
    recentCategories,
  };
}

export default function DashboardScreen() {
  const routeParams = useLocalSearchParams<{
    actionReceiptHandoff?: string | string[];
  }>();
  const actionReceiptHandoffParam = Array.isArray(routeParams.actionReceiptHandoff)
    ? routeParams.actionReceiptHandoff[0] ?? null
    : routeParams.actionReceiptHandoff ?? null;
  const loadCoordinatorRef = useRef(createDashboardLoadCoordinator());
  const consumedActionReceiptHandoffRef = useRef<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [careRefreshVersion, setCareRefreshVersion] = useState(0);
  const [todayOneResumeRefreshVersion, setTodayOneResumeRefreshVersion] = useState(0);
  const [actionReceiptReleaseVersion, setActionReceiptReleaseVersion] = useState(0);
  const [sessionRefreshVersion, setSessionRefreshVersion] = useState(0);
  const [error, setError] = useState(false);
  const [actionReceiptReadError, setActionReceiptReadError] = useState(false);
  const [actionReceiptUnavailable, setActionReceiptUnavailable] = useState(false);
  const coupleIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const hasFocusedOnceRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const readCurrentOwnerUserId = useCallback(async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    return authError ? null : user?.id ?? null;
  }, []);

  const readCurrentIdentity = useCallback(async (): Promise<DashboardIdentity | null> => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return null;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile) return null;
    const currentOwnerUserId = await readCurrentOwnerUserId();
    if (currentOwnerUserId !== user.id) return null;
    return {
      ownerUserId: user.id,
      coupleId: typeof profile.couple_id === "string" ? profile.couple_id : null,
    };
  }, [readCurrentOwnerUserId]);

  const clearDashboardSession = useCallback(() => {
    loadCoordinatorRef.current.invalidateSession();
    coupleIdRef.current = null;
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setData(null);
    setError(false);
    setActionReceiptReadError(false);
    setActionReceiptUnavailable(false);
    setRefreshing(false);
    setLoading(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      const coordinator = loadCoordinatorRef.current;
      const pinnedLease = coordinator.getPinnedActionReceiptLease();
      if (!pinnedLease) {
        clearDashboardSession();
        setSessionRefreshVersion((version) => version + 1);
        return;
      }
      const expectedSessionGeneration = coordinator.currentSessionGeneration();
      void readCurrentIdentity().then((currentIdentity) => {
        if (!coordinator.isSessionCurrent(expectedSessionGeneration)) return;
        if (
          currentIdentity?.ownerUserId === pinnedLease.identity.ownerUserId
          && currentIdentity?.coupleId === pinnedLease.identity.coupleId
        ) {
          coordinator.deferReloadForPinnedReceipt(pinnedLease.identity);
          return;
        }
        clearDashboardSession();
        setSessionRefreshVersion((version) => version + 1);
      });
    }, [clearDashboardSession, readCurrentIdentity]),
  );

  const loadData = useCallback(async () => {
    const loadTicket = loadCoordinatorRef.current.beginLoad();
    const verifyLoadIdentity = async (expectedIdentity: DashboardIdentity) => {
      const verified = await loadCoordinatorRef.current.verifyCurrentIdentity(
        loadTicket,
        expectedIdentity,
        readCurrentIdentity,
      );
      if (!verified && loadCoordinatorRef.current.isCurrent(loadTicket)) {
        clearDashboardSession();
        setLoading(false);
        setError(true);
      }
      return verified;
    };
    try {
      setError(false);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!loadCoordinatorRef.current.isCurrent(loadTicket)) return;
        setData(null);
        router.replace("/(auth)/login");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("name, couple_id")
        .eq("id", user.id)
        .single();
      if (profileError) throw profileError;
      const expectedIdentity: DashboardIdentity = {
        ownerUserId: user.id,
        coupleId: profile.couple_id ?? null,
      };

      if (!profile.couple_id) {
        if (!await verifyLoadIdentity(expectedIdentity)) return;
        coupleIdRef.current = null;
        setData({
          ownerUserId: user.id,
          coupleId: null,
          name: profile.name ?? null,
          weddingDate: null,
          totalBudget: 0,
          progress: {},
          preparationOverview: null,
          todayTasks: [],
          dday: null,
          urgentTasks: [],
          bookingOutcomeTasks: [],
          openAction: null,
          receiptActionId: null,
          actionFeedback: null,
          partnerActivity: null,
          personalization: null,
          coupleCriterionLoaded: false,
          coupleCriterion: null,
          coreCriterionLoaded: false,
          coreCriterion: null,
        });
        setActionReceiptReadError(false);
        setActionReceiptUnavailable(false);
        return;
      }

      let receiptAction: DashboardOpenAction | null = null;
      let receiptActionId: string | null = null;
      if (
        actionReceiptHandoffParam
        && consumedActionReceiptHandoffRef.current !== actionReceiptHandoffParam
      ) {
        if (!await verifyLoadIdentity(expectedIdentity)) return;
        const receiptResolution = await resolveActionReceiptHomeHandoff({
          handoffId: actionReceiptHandoffParam,
          expectedOwnerUserId: user.id,
          expectedCoupleId: profile.couple_id,
          isResolutionCurrent: () =>
            loadCoordinatorRef.current.isCurrent(loadTicket),
          readCurrentOpenAction: readCurrentOpenAmoraAction,
        });
        if (!loadCoordinatorRef.current.isCurrent(loadTicket)) return;
        if (receiptResolution.state === "retry") {
          setActionReceiptReadError(true);
          return;
        }
        consumedActionReceiptHandoffRef.current = actionReceiptHandoffParam;
        if (receiptResolution.state === "rejected") {
          setActionReceiptUnavailable(true);
          setActionReceiptReadError(false);
          setLoading(false);
          return;
        }
        if (receiptResolution.state === "focused") {
          setActionReceiptUnavailable(false);
          receiptAction = receiptResolution.action;
          receiptActionId = receiptResolution.action.id;
        }
      }

      const [journeyResult, openAction, actionFeedback] = await Promise.all([
        supabase
          .from("wedding_journeys")
          .select("wedding_date, total_budget, progress")
          .eq("couple_id", profile.couple_id)
          .single(),
        receiptAction
          ? Promise.resolve(receiptAction)
          : loadPreferredOpenAmoraAction(profile.couple_id),
        loadOwnerAmoraActionOutcomeFeedback(
          user.id,
          profile.couple_id,
          apiFetchForExpectedUser,
        ),
      ]);
      const { data: journey, error: journeyError } = journeyResult;
      if (journeyError) throw journeyError;
      if (!journey) throw new Error("wedding journey missing");
      if (!await verifyLoadIdentity(expectedIdentity)) return;
      if (loadCoordinatorRef.current.deferReloadForPinnedReceipt(expectedIdentity)) return;
      coupleIdRef.current = expectedIdentity.coupleId;

      const progress =
        (journey.progress as Record<string, unknown> | null) ?? {};
      const todayKey = formatLocalDateKey();
      const events = Array.isArray(progress.__events)
        ? progress.__events
        : [];
      const todayTasks = events
        .filter((event) => isActiveScheduleEvent(event) && event.date === todayKey)
        .map((event) => ({
          title: event.title,
          categoryKey: event.categoryKey ?? "",
        }));
      const weddingDate = journey.wedding_date ?? null;
      const dday = calcDday(weddingDate);
      const urgentTasks = calcUrgentTasks(dday, progress);
      const preparationOverview = buildAmoraPreparationOverview({
        topics: CATEGORY_CHECKLISTS,
        progress,
        attentionTopicKeys: urgentTasks.map((task) => task.categoryKey),
      });

      const coreData: DashboardData = {
        ownerUserId: user.id,
        coupleId: profile.couple_id,
        name: profile.name,
        weddingDate,
        totalBudget: journey.total_budget ?? 0,
        progress,
        preparationOverview,
        todayTasks,
        dday,
        urgentTasks,
        bookingOutcomeTasks: [],
        openAction,
        receiptActionId: openAction?.id === receiptActionId
          ? receiptActionId
          : null,
        actionFeedback,
        partnerActivity: null,
        personalization: null,
        coupleCriterionLoaded: false,
        coupleCriterion: null,
        coreCriterionLoaded: false,
        coreCriterion: null,
      };

      // 홈의 핵심 맥락과 오늘의 행동을 먼저 그린 뒤, 보조 데이터를 이어 붙인다.
      setData(coreData);
      setActionReceiptReadError(false);
      setLoading(false);
      setRefreshing(false);

      const [
        bookingOutcomeTasks,
        partnerActivity,
        personalization,
        coupleCriterionResult,
        coreCriterionResult,
      ] = await Promise.all([
        loadBookingOutcomeTasks(profile.couple_id),
        loadPartnerActivity({
          coupleId: profile.couple_id,
          userId: user.id,
          progress,
        }),
        loadOwnerAmoraPersonalization(user.id, apiFetchForExpectedUser),
        loadOwnerAmoraCoupleCriterion(
          user.id,
          profile.couple_id,
          apiFetchForExpectedUser,
        ),
        loadOwnerAmoraCoreCriterion(user.id, apiFetchForExpectedUser),
      ]);

      if (!await verifyLoadIdentity(expectedIdentity)) return;
      if (loadCoordinatorRef.current.deferReloadForPinnedReceipt(expectedIdentity)) return;

      setData((current) =>
        loadCoordinatorRef.current.mergeForIdentity(
          loadTicket,
          expectedIdentity,
          current,
          {
            bookingOutcomeTasks,
            partnerActivity,
            personalization,
            coupleCriterionLoaded: coupleCriterionResult.loaded,
            coupleCriterion: coupleCriterionResult.value,
            coreCriterionLoaded: coreCriterionResult.loaded,
            coreCriterion: coreCriterionResult.criterion,
          },
        ),
      );
    } catch {
      if (loadCoordinatorRef.current.isCurrent(loadTicket)) setError(true);
    } finally {
      if (loadCoordinatorRef.current.isCurrent(loadTicket)) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [actionReceiptHandoffParam, clearDashboardSession, readCurrentIdentity]);

  useEffect(() => {
    let active = true;
    let reloadScheduled = false;
    let initializationScheduled = false;
    let restartScheduled = false;
    let identityReconciliationScheduled = false;
    let observedAuthUserId: string | null | undefined;
    let subscribedIdentity: DashboardIdentity | null = null;
    const scheduleReload = () => {
      if (!active || reloadScheduled) return;
      if (loadCoordinatorRef.current.deferReloadForPinnedReceipt()) return;
      reloadScheduled = true;
      queueMicrotask(() => {
        reloadScheduled = false;
        if (!active) return;
        void loadData();
      });
    };

    const restartDashboardSession = () => {
      if (!active || restartScheduled) return;
      restartScheduled = true;
      subscribedIdentity = null;
      clearDashboardSession();
      setSessionRefreshVersion((version) => version + 1);
    };

    const scheduleDashboardIdentityReconciliation = (
      expectedIdentity: DashboardIdentity | null,
    ) => {
      if (!active || identityReconciliationScheduled) return;
      if (!expectedIdentity) {
        restartDashboardSession();
        return;
      }
      identityReconciliationScheduled = true;
      const expectedSessionGeneration =
        loadCoordinatorRef.current.currentSessionGeneration();
      queueMicrotask(async () => {
        identityReconciliationScheduled = false;
        if (
          !active
          || !loadCoordinatorRef.current.isSessionCurrent(
            expectedSessionGeneration,
          )
        ) return;
        const currentIdentity = await readCurrentIdentity();
        if (
          !active
          || !loadCoordinatorRef.current.isSessionCurrent(
            expectedSessionGeneration,
          )
        ) return;
        if (
          currentIdentity?.ownerUserId === expectedIdentity.ownerUserId
          && currentIdentity?.coupleId === expectedIdentity.coupleId
        ) {
          setTodayOneResumeRefreshVersion((version) => version + 1);
          scheduleReload();
          return;
        }
        restartDashboardSession();
      });
    };

    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextAppState) => {
        const previousAppState = appStateRef.current;
        appStateRef.current = nextAppState;
        if (previousAppState !== "active" && nextAppState === "active") {
          scheduleDashboardIdentityReconciliation(
            subscribedIdentity
            ?? loadCoordinatorRef.current.getPinnedActionReceiptLease()?.identity
            ?? null,
          );
        }
      },
    );

    const initializeDashboardSession = async () => {
      const subscriptionSessionGeneration =
        loadCoordinatorRef.current.currentSessionGeneration();
      await loadData();
      if (
        !active
        || !loadCoordinatorRef.current.isSessionCurrent(
          subscriptionSessionGeneration,
        )
      ) return;
      const expectedIdentity = await readCurrentIdentity();
      if (
        !expectedIdentity
        || coupleIdRef.current !== expectedIdentity.coupleId
        || channelRef.current
      ) return;

      const coupleId = expectedIdentity.coupleId;
      subscribedIdentity = expectedIdentity;
      let channel = supabase
        .channel(
          `dashboard:${expectedIdentity.ownerUserId}:${coupleId ?? "unlinked"}:${subscriptionSessionGeneration}`,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${expectedIdentity.ownerUserId}`,
          },
          () => {
            if (
              loadCoordinatorRef.current.isSessionCurrent(
                subscriptionSessionGeneration,
              )
            ) scheduleDashboardIdentityReconciliation(expectedIdentity);
          },
        );

      if (coupleId) {
        channel = channel.on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "wedding_journeys",
            filter: `couple_id=eq.${coupleId}`,
          },
          () => {
            if (
              loadCoordinatorRef.current.isSessionCurrent(
                subscriptionSessionGeneration,
              )
            ) scheduleReload();
          },
        ).on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "vendor_bookings",
            filter: `couple_id=eq.${coupleId}`,
          },
          () => {
            if (
              loadCoordinatorRef.current.isSessionCurrent(
                subscriptionSessionGeneration,
              )
            ) scheduleReload();
          },
        );
      }
      let hasSubscribed = false;
      channel = channel.subscribe((status) => {
        if (
          !active
          || !loadCoordinatorRef.current.isSessionCurrent(
            subscriptionSessionGeneration,
          )
        ) return;

        if (status === "SUBSCRIBED") {
          if (!hasSubscribed) {
            hasSubscribed = true;
            return;
          }

          // 재연결은 오프라인 중 놓친 프로필 변경을 재전송하지 않는다.
          scheduleDashboardIdentityReconciliation(expectedIdentity);
        }
      });

      const currentIdentity = await readCurrentIdentity();
      if (
        !active
        || !loadCoordinatorRef.current.isSessionCurrent(
           subscriptionSessionGeneration,
         )
        || currentIdentity?.ownerUserId !== expectedIdentity.ownerUserId
        || currentIdentity?.coupleId !== expectedIdentity.coupleId
      ) {
        void supabase.removeChannel(channel);
        if (active) restartDashboardSession();
        return;
      }
      channelRef.current = channel;
    };

    const scheduleInitialization = () => {
      if (!active || initializationScheduled) return;
      initializationScheduled = true;
      queueMicrotask(() => {
        initializationScheduled = false;
        if (!active) return;
        void initializeDashboardSession();
      });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const nextOwnerUserId = session?.user.id ?? null;
        if (event === "INITIAL_SESSION") {
          observedAuthUserId = nextOwnerUserId;
          return;
        }
        if (nextOwnerUserId === observedAuthUserId) return;
        observedAuthUserId = nextOwnerUserId;
        clearDashboardSession();
        if (!nextOwnerUserId) {
          setLoading(false);
          router.replace("/(auth)/login");
          return;
        }
        setSessionRefreshVersion((version) => version + 1);
      },
    );

    scheduleInitialization();

    return () => {
      active = false;
      appStateSubscription.remove();
      subscription.unsubscribe();
      loadCoordinatorRef.current.invalidateSession();
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [
    clearDashboardSession,
    loadData,
    readCurrentIdentity,
    sessionRefreshVersion,
  ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const pinnedLease = loadCoordinatorRef.current.getPinnedActionReceiptLease();
    if (pinnedLease?.phase === "provisional") {
      loadCoordinatorRef.current.deferReloadForPinnedReceipt(pinnedLease.identity);
      setRefreshing(false);
      return;
    }
    if (data && pinnedLease) {
      const released = loadCoordinatorRef.current.releasePinnedActionReceipt(
        {
          ownerUserId: data.ownerUserId,
          coupleId: data.coupleId,
        },
        pinnedLease.token,
      );
      if (released.released) {
        setActionReceiptReleaseVersion((version) => version + 1);
      }
    }
    await loadData();
    setCareRefreshVersion((version) => version + 1);
  }, [data, loadData]);

  if (actionReceiptReadError) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <ErrorRetry
          message="방금 저장한 행동을 아직 확인하지 못했어요. 다른 행동을 보여주지 않고 다시 확인할게요."
          onRetry={() => {
            setLoading(true);
            void loadData();
          }}
        />
      </SafeAreaView>
    );
  }

  if (actionReceiptUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <EmptyState
          title="이 행동은 지금 이어갈 수 없어요"
          description="이미 완료되었거나 변경된 행동일 수 있어요. 다른 행동으로 바꾸지 않았으니 우리 준비 노트에서 기록을 다시 확인해 주세요."
          action={(
            <PrimaryButton onPress={() => router.replace("/amora-notes" as never)}>
              우리 준비 노트로 돌아가기
            </PrimaryButton>
          )}
        />
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <ErrorRetry
          message="결혼 준비 현황을 불러올 수 없어요"
          onRetry={() => {
            setLoading(true);
            loadData();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <WeddingHomeExperience
        data={data}
        loading={loading}
        refreshing={refreshing}
        onRefresh={onRefresh}
        renderTodayOneCare={(companionFallback, focus) => {
          if (!data?.coupleId) return companionFallback;

          const todayOneCare = (
            <TodayOneCareCard
              refreshVersion={careRefreshVersion + todayOneResumeRefreshVersion}
              fallback={companionFallback}
              expectedOwnerUserId={data.ownerUserId}
              expectedCoupleId={data.coupleId}
            />
          );
          const mediatedCare = (
            <AmoraMediationOutcomeFollowUp
              refreshVersion={careRefreshVersion}
              expectedOwnerUserId={data.ownerUserId}
              expectedCoupleId={data.coupleId}
              loadingFallback={companionFallback}
              fallback={todayOneCare}
            />
          );

          if (focus.kind !== "action" || !data.openAction) return mediatedCare;
          if (focus.suppressActionFollowUpClaim) return companionFallback;
          const openAction = data.openAction;
          const receiptLeaseSessionGeneration =
            loadCoordinatorRef.current.currentSessionGeneration();

          const renderActionCare = (actionFallback: ReactNode) => (
            <AmoraActionFollowUpV2
              refreshVersion={careRefreshVersion}
              receiptReleaseVersion={actionReceiptReleaseVersion}
              expectedOwnerUserId={data.ownerUserId}
              expectedCoupleId={data.coupleId}
              preferredActionId={openAction.id}
              preferredActionPresentation={
                openAction.sourceRevision !== null && focus.selectionReason
                  ? {
                      id: openAction.id,
                      title: openAction.title,
                      sourceRevision: openAction.sourceRevision,
                      selectionReason: focus.selectionReason,
                    }
                  : null
              }
              loadingFallback={companionFallback}
              fallback={actionFallback}
              onReceiptSubmissionStarted={(receiptIdentity) =>
                loadCoordinatorRef.current.beginActionReceiptLease(
                  receiptIdentity,
                  receiptLeaseSessionGeneration,
                )}
              onReceiptSubmissionAborted={async (receiptIdentity, leaseToken) => {
                const released =
                  loadCoordinatorRef.current.releasePinnedActionReceipt(
                    receiptIdentity,
                    leaseToken,
                  );
                if (released.released && released.hadDeferredReload) {
                  await loadData();
                }
              }}
              onReceiptPinned={(receiptIdentity, leaseToken) =>
                loadCoordinatorRef.current.confirmActionReceiptLease(
                  receiptIdentity,
                  leaseToken,
                )}
              onReceiptAcknowledged={async (_receipt, receiptIdentity, leaseToken) => {
                loadCoordinatorRef.current.releasePinnedActionReceipt(
                  receiptIdentity,
                  leaseToken,
                );
                await loadData();
              }}
            />
          );

          if (focus.claimBeforeCare) return renderActionCare(mediatedCare);

          const ordinaryActionCare = renderActionCare(companionFallback);
          const todayOneBeforeOrdinaryAction = (
            <TodayOneCareCard
              refreshVersion={careRefreshVersion + todayOneResumeRefreshVersion}
              fallback={ordinaryActionCare}
              expectedOwnerUserId={data.ownerUserId}
              expectedCoupleId={data.coupleId}
            />
          );
          return (
            <AmoraMediationOutcomeFollowUp
              refreshVersion={careRefreshVersion}
              expectedOwnerUserId={data.ownerUserId}
              expectedCoupleId={data.coupleId}
              loadingFallback={companionFallback}
              fallback={todayOneBeforeOrdinaryAction}
            />
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
