// 웨딩 라운지 — 우리의 결혼식, 오늘의 한 가지, 준비 서비스 (Supabase 실데이터)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "@hanbang/design-tokens";
import { buildAmoraPreparationOverview } from "@hanbang/shared/amora-preparation-map";
import {
  buildAmoraFirstHello,
  buildLoungeFirstRunView,
  FIRST_RUN_TUTORIAL_COLUMNS,
  isOnlyStageSuggestion,
  PREPARATION_STAGE_PROGRESS_KEY,
  PREPARATION_STAGE_VALUES,
  shouldShowFirstRunTutorial,
  WEDDING_STYLE_OPTIONS,
  type PreparationStageValue,
} from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import {
  loadLoungeActionFeedback,
  loadLoungeCoreCriterion,
  loadLoungeCoupleCriterion,
  loadLoungePersonalization,
} from "@/lib/loungeOwnerData.mjs";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import {
  DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT,
  formatLocalDateKey,
  selectDashboardOpenAction,
  type DashboardOpenAction,
} from "@/lib/dashboardExperience.mjs";
import { resolveActionReceiptHomeHandoff } from "@/lib/actionReceiptHomeHandoff.mjs";
import { isActiveScheduleEvent } from "@/lib/scheduleMutation.mjs";
import type { AmoraPersonalizationPreferences } from "@/lib/amoraPersonalization.mjs";
import {
  hasCoupleMadeData,
  readRecordedCategoryStatuses,
  readWeddingStyleValue,
} from "@/lib/loungeFirstArrival.mjs";
import {
  hasShownFirstRunTutorialOnDevice,
  loadFirstRunTutorialState,
  markFirstRunTutorialCompleted,
  noteFirstRunTutorialOpened,
  rememberFirstRunTutorialShown,
  type FirstRunTutorialProfileGateway,
} from "@/lib/firstRunTutorial";
import {
  dismissAmoraFirstHelloBubble,
  peekPendingAmoraFirstHello,
  rememberPendingAmoraFirstHello,
} from "@/lib/amoraFirstHello";
import ErrorRetry from "@/components/ErrorRetry";
import { EmptyState, PrimaryButton } from "@/components/ui/AppUI";
import AmoraActionFollowUpV2 from "@/components/dashboard/AmoraActionFollowUpV2";
import AmoraMediationOutcomeFollowUp from "@/components/dashboard/AmoraMediationOutcomeFollowUp";
import TodayOneCareCard from "@/components/dashboard/TodayOneCareCard";
import WeddingHomeExperience, {
  type WeddingHomeData,
} from "@/components/dashboard/WeddingHomeExperience";
import AmoraFab from "@/components/lounge/AmoraFab";
import { FirstRunAnchorProvider } from "@/components/lounge/FirstRunAnchors";
import FirstRunCoachMarks, {
  type FirstRunCoachMarksOutcome,
} from "@/components/lounge/FirstRunCoachMarks";
import LoungeFirstArrival, {
  LoungeEmptyNote,
} from "@/components/lounge/LoungeFirstArrival";

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
  coupleId: string | null;
  /** 온보딩에서 받은 한 줄 단계. 첫 도착 화면이 되읽고, 다음 걸음을 여기서 고른다. */
  preparationStage: PreparationStageValue | null;
  /** 온보딩에서 고른 분위기 라벨. 고르지 않았으면 null이고, 그러면 그 줄은 없다. */
  weddingStyleLabel: string | null;
  /**
   * 이 커플에 상대가 들어와 있는가. 확인하지 못했으면 undefined다.
   * 계약은 `false`일 때만 초대 카드를 만들므로, 모르는 동안에는 아무 말도 하지 않는다 —
   * 이미 연결된 사람에게 "초대 코드를 보내세요"는 틀린 안내다.
   */
  partnerLinked: boolean | undefined;
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

/** 첫 실행 안내와 아모라 첫마디를 만들 때 필요한, 이 사람에 대해 이미 아는 것. */
interface FirstRunProfileContext {
  userId: string;
  coupleId: string | null;
  weddingDate: string | null;
  preparationStage: PreparationStageValue | null;
}

/** 온보딩에서 고른 한 줄 단계. 모르는 값이면 null — 없는 것을 지어내지 않는다. */
function readPreparationStage(
  progress: Record<string, unknown>,
): PreparationStageValue | null {
  const stage = progress[PREPARATION_STAGE_PROGRESS_KEY];
  return PREPARATION_STAGE_VALUES.includes(stage as PreparationStageValue)
    ? (stage as PreparationStageValue)
    : null;
}

/**
 * 온보딩에서 고른 분위기를 사람이 읽는 한 줄로. 고르지 않았거나 모르는 값이면 null —
 * 첫 도착 화면은 그 줄을 아예 그리지 않는다. 빈칸으로 두면 입력을 빠뜨린 것처럼 보인다.
 */
function readWeddingStyleLabel(
  progress: Record<string, unknown>,
): string | null {
  const value = readWeddingStyleValue(progress);
  return (
    WEDDING_STYLE_OPTIONS.find((option) => option.value === value)?.label
    ?? null
  );
}

/**
 * 첫 실행 안내 상태를 읽고 쓰는 통로.
 *
 * 새 RPC를 만들지 않는다 — profiles에는 이미 본인 행만 허용하는 UPDATE 정책이 있고,
 * 이 값은 "내가 안내를 봤다"는 자기 신고라 남의 행을 건드리지 않는다.
 *
 * 읽기를 이름·couple_id를 가져오는 select에 합치지 않는 이유: 그 컬럼들은 아직 운영 DB에
 * 없을 수 있고(마이그레이션 미적용), 합쳐 두면 안내 플래그 하나 때문에 라운지 전체가
 * 오류 화면이 된다.
 */
function createFirstRunTutorialGateway(
  userId: string,
): FirstRunTutorialProfileGateway {
  return {
    async readState() {
      return await supabase
        .from("profiles")
        .select(FIRST_RUN_TUTORIAL_COLUMNS)
        .eq("id", userId)
        .maybeSingle();
    },
    async writeCompletion(patch) {
      return await supabase.from("profiles").update(patch).eq("id", userId);
    },
  };
}

/**
 * 이 커플에 상대가 이미 들어와 있는가.
 *
 * 확인하지 못하면 undefined다. buildAmoraFirstHello는 `false`일 때만 초대 한 줄을 덧붙이므로,
 * 모를 때는 아무 말도 하지 않는다 — 이미 연결된 사람에게 "초대 코드를 보내세요"라고 하는 것은
 * 틀린 안내다.
 */
async function loadPartnerLinked(
  coupleId: string,
  userId: string,
): Promise<boolean | undefined> {
  try {
    const { data, error } = await supabase
      .from("couple_profile_directory")
      .select("id")
      .eq("couple_id", coupleId)
      .neq("id", userId)
      .limit(1);
    if (error) return undefined;
    return (data?.length ?? 0) > 0;
  } catch {
    return undefined;
  }
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
  const [firstRunTutorialOpen, setFirstRunTutorialOpen] = useState(false);
  const [amoraBubble, setAmoraBubble] = useState<string | null>(null);
  // 말풍선을 닫는 것과 첫마디를 읽는 것은 다른 일이다. 말풍선을 X로 접었다고 점까지 지우면,
  // 아모라가 남긴 말이 대화에 기다린다는 표시가 화면에서 통째로 사라진다.
  const [amoraUnread, setAmoraUnread] = useState(false);
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
  const firstRunProfileRef = useRef<FirstRunProfileContext | null>(null);
  // 이 화면이 살아 있는 동안 한 번만 판정한다. 리얼타임 갱신마다 다시 물으면
  // 같은 사람에게 같은 질문을 계속 던지게 된다.
  const firstRunCheckedRef = useRef(false);
  // 컬럼이 아직 없는 배포면 완료 기록도 시도하지 않는다 — 같은 이유로 반드시 실패한다.
  const firstRunColumnsMissingRef = useRef(false);

  /**
   * 지금 이 사람에게 첫 실행 안내를 띄워야 하는가.
   *
   * 온보딩을 마치지 않았으면 절대 띄우지 않는다. 프로필 읽기가 실패해도 화면은 그대로
   * 두고 "아직 안 봤다"로 본다 — 안내 플래그 때문에 첫 화면이 오류가 되면 안 된다.
   */
  const evaluateFirstRunTutorial = useCallback(
    async (userId: string, onboardingCompleted: boolean) => {
      if (firstRunCheckedRef.current) return;
      firstRunCheckedRef.current = true;

      if (!onboardingCompleted) return;

      const shownThisSession = await hasShownFirstRunTutorialOnDevice(AsyncStorage);
      const read = await loadFirstRunTutorialState(
        createFirstRunTutorialGateway(userId),
      );
      firstRunColumnsMissingRef.current = read.columnsMissing;

      if (
        !shouldShowFirstRunTutorial({
          onboardingCompleted,
          state: read.state,
          shownThisSession,
        })
      ) {
        return;
      }

      // 여는 시점에는 메모리 표식만 남긴다. 영구 표식은 안내가 끝났을 때 적는다 —
      // 여기서 적으면 안내 도중 앱이 회수된 사람이 그 기기에서 안내를 영영 잃는다.
      noteFirstRunTutorialOpened();
      setFirstRunTutorialOpen(true);
    },
    [],
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
        .select("name, couple_id, onboarding_completed")
        .eq("id", user.id)
        .single();
      if (profileError) throw profileError;
      const expectedIdentity: DashboardIdentity = {
        ownerUserId: user.id,
        coupleId: profile.couple_id ?? null,
      };

      coupleIdRef.current = profile.couple_id ?? null;
      const onboardingCompleted = profile.onboarding_completed === true;

      if (!profile.couple_id) {
        if (!await verifyLoadIdentity(expectedIdentity)) return;
        coupleIdRef.current = null;
        firstRunProfileRef.current = {
          userId: user.id,
          coupleId: null,
          weddingDate: null,
          preparationStage: null,
        };
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
          preparationStage: null,
          weddingStyleLabel: null,
          partnerLinked: undefined,
        });
        setActionReceiptReadError(false);
        setActionReceiptUnavailable(false);
        void evaluateFirstRunTutorial(user.id, onboardingCompleted);
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
        loadLoungeActionFeedback(user.id, profile.couple_id),
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
        preparationStage: readPreparationStage(progress),
        weddingStyleLabel: readWeddingStyleLabel(progress),
        // 상대가 있는지는 질의가 한 번 더 필요해서 아래에서 이어 붙인다. 그동안은 undefined라
        // 초대 카드가 뜨지 않는다 — 없는 카드가 늦게 뜨는 편이, 틀린 카드가 먼저 뜨는 것보다 낫다.
        partnerLinked: undefined,
      };

      firstRunProfileRef.current = {
        userId: user.id,
        coupleId: profile.couple_id,
        weddingDate,
        preparationStage: readPreparationStage(progress),
      };

      // 라운지의 핵심 맥락과 오늘의 행동을 먼저 그린 뒤, 보조 데이터를 이어 붙인다.
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
        partnerLinked,
      ] = await Promise.all([
        loadBookingOutcomeTasks(profile.couple_id),
        loadPartnerActivity({
          coupleId: profile.couple_id,
          userId: user.id,
          progress,
        }),
        loadLoungePersonalization(user.id),
        loadLoungeCoupleCriterion(user.id, profile.couple_id),
        loadLoungeCoreCriterion(user.id),
        loadPartnerLinked(profile.couple_id, user.id),
      ]);
      // 화면이 그려진 뒤에 안내를 판정한다. 앵커가 아직 없는 화면 위에 안내를 띄우면
      // 모든 단계가 "못 잡았다"로 건너뛰어진다.
      void evaluateFirstRunTutorial(user.id, onboardingCompleted);

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
            partnerLinked,
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
  }, [
    actionReceiptHandoffParam,
    clearDashboardSession,
    readCurrentIdentity,
    evaluateFirstRunTutorial,
  ]);

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

  // 안내를 마친 뒤 앱이 꺼졌다 켜져도 아모라의 첫마디는 기다리고 있어야 한다.
  // 완료 사실은 이미 프로필에 적혀서 안내는 다시 뜨지 않으므로, 여기서 되살리지 않으면
  // 그 사람은 "먼저 말을 거는 아모라"를 영영 만나지 못한다.
  useEffect(() => {
    let active = true;
    void (async () => {
      const pending = await peekPendingAmoraFirstHello({ storage: AsyncStorage });
      if (!active || !pending) return;
      // 아직 대화에서 소비되지 않은 첫마디가 있다 = 아직 안 읽었다. 말풍선을 접었더라도
      // 점은 남아야 "아모라가 뭔가 남겼다"가 화면에 남는다.
      setAmoraUnread(true);
      if (pending.bubbleDismissed) return;
      setAmoraBubble(pending.preview);
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleFirstRunTutorialClose = useCallback(
    async (outcome: FirstRunCoachMarksOutcome) => {
      setFirstRunTutorialOpen(false);

      // 기기 표식은 여기서만 적는다. "unavailable"은 짚을 요소가 하나도 없어 이 사람이
      // 아무것도 못 봤다는 뜻이라, 그때는 적지 않고 다음 실행에서 한 번 더 시도한다.
      if (outcome !== "unavailable") {
        void rememberFirstRunTutorialShown(AsyncStorage);
      }

      const context = firstRunProfileRef.current;
      if (!context) return;

      // 짚을 수 있는 요소가 하나도 없었으면 이 사람은 안내를 못 봤다. 완료로 적지 않는다 —
      // 다음에 화면이 제대로 그려졌을 때 한 번 더 시도해야 한다.
      //
      // 다만 **첫마디는 그것과 무관하게 건넨다.** 아모라가 먼저 말을 거는 것은 안내를
      // 봤는지가 아니라 온보딩을 마쳤는지에 달려 있고, 앵커 측정은 스크롤 위치나 기기
      // 사정으로도 실패한다. 여기서 같이 멈추면 측정이 한 번 어긋났다는 이유로 그 사람은
      // 안내도 못 보고 아모라도 말을 걸지 않는, 가장 조용한 실패를 겪는다.
      // 웹은 같은 상황에서도 완료 이벤트를 쏘므로 최소한 말풍선은 뜬다 — 두 플랫폼의
      // 실패 방향이 반대여서는 안 된다.
      if (outcome !== "unavailable" && !firstRunColumnsMissingRef.current) {
        // 완주든 건너뛰기든 완료다. 실패해도 화면을 막지 않는다.
        void markFirstRunTutorialCompleted(
          createFirstRunTutorialGateway(context.userId),
        );
      }

      // 첫마디는 모델이 쓰지 않는다. 이 사람이 온보딩에서 직접 적은 것만으로 만든다 —
      // 네트워크가 느려도, 토큰이 없어도, 두 사람이 같은 말을 받는다.
      const partnerLinked = context.coupleId
        ? await loadPartnerLinked(context.coupleId, context.userId)
        : false;
      const hello = buildAmoraFirstHello({
        weddingDate: context.weddingDate,
        preparationStage: context.preparationStage,
        partnerLinked,
        now: Date.now(),
      });

      await rememberPendingAmoraFirstHello(hello, { storage: AsyncStorage });
      setAmoraBubble(hello.preview);
      setAmoraUnread(true);
    },
    [],
  );

  /**
   * 첫 도착 화면을 지금 보여줄 것인가.
   *
   * 별도 플래그를 두지 않는다. 두 사람이 만든 것이 하나라도 생기면 `hasCoupleMadeData`가
   * true가 되고, 이 값은 그 다음 렌더에서 저절로 null이 된다 — "데이터가 있는데 첫 도착
   * 화면"이 남는 경로 자체가 없다.
   *
   * 커플이 없는 사람에게는 보여주지 않는다. 온보딩을 끝내지 못한 상태라 되읽어 줄 것도
   * 없고, 라운지 히어로가 이미 "결혼식 날짜를 알려주세요"로 그 사람을 데려간다.
   */
  const firstArrivalView = useMemo(() => {
    if (!data || !data.coupleId) return null;
    // 남아 있는 카테고리 상태가 **온보딩이 채워준 제안값 그대로**면 아직 아무것도 안 한
    // 상태다. 온보딩 마지막 화면에서 "저장하고 시작하기"를 누르면 고른 단계의 제안값이
    // 그대로 저장되는데, 그걸 만든 데이터로 세면 `just_started`가 아닌 단계를 고른 사람 —
    // 5개 중 4개 — 은 첫 도착 화면도, 그 안에만 있는 초대 안내 단계도 한 번도 못 본다.
    // 판정은 웹과 같은 공유 계약이 하고, 한 칸이라도 손으로 고쳤으면 진짜 입력이다.
    const recordedCategories = readRecordedCategoryStatuses(data.progress);
    const onlyStageSuggestion = isOnlyStageSuggestion(
      recordedCategories,
      data.preparationStage,
    );
    if (
      hasCoupleMadeData({
        progress: data.progress,
        bookingOutcomeTasks: data.bookingOutcomeTasks,
        ignoredCategoryKeys: onlyStageSuggestion
          ? Object.keys(recordedCategories)
          : [],
      })
    ) {
      return null;
    }
    return buildLoungeFirstRunView({
      weddingDate: data.weddingDate,
      preparationStage: data.preparationStage,
      weddingStyleLabel: data.weddingStyleLabel,
      partnerLinked: data.partnerLinked,
      now: Date.now(),
    });
  }, [data]);

  const handleAmoraFabPress = useCallback(() => {
    // 말풍선은 눌리면 사라지고 다시 뜨지 않는다. 첫마디 자체는 대화 화면이 가져간다.
    setAmoraBubble(null);
    // 대화로 들어가는 순간이 곧 읽는 순간이다.
    setAmoraUnread(false);
    // 진입구마다 다른 맥락을 들고 간다. 라운지의 버튼에서 왔다는 것만으로도 대화 첫 줄이
    // 달라져야, 네 개의 문이 같은 빈 화면으로 떨어지지 않는다.
    router.push("/(tabs)/chat?entry=lounge_fab");
  }, []);

  const handleDismissAmoraBubble = useCallback(() => {
    // 접는 것은 "알림 봤다"이지 "첫마디 필요 없다"가 아니다. 점은 그대로 둔다.
    setAmoraBubble(null);
    void dismissAmoraFirstHelloBubble({ storage: AsyncStorage });
  }, []);

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
      <FirstRunAnchorProvider>
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
          firstArrival={
            firstArrivalView ? (
              <LoungeFirstArrival view={firstArrivalView} />
            ) : null
          }
          emptyNote={
            firstArrivalView ? (
              <LoungeEmptyNote note={firstArrivalView.emptyNote} />
            ) : null
          }
        />
        <AmoraFab
          onPress={handleAmoraFabPress}
          bubbleText={amoraBubble}
          unread={amoraUnread}
          onDismissBubble={handleDismissAmoraBubble}
        />
        {firstRunTutorialOpen ? (
          <FirstRunCoachMarks onClose={handleFirstRunTutorialClose} />
        ) : null}
      </FirstRunAnchorProvider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
