// 웨딩 라운지 — 우리의 결혼식, 오늘의 한 가지, 준비 서비스 (Supabase 실데이터)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "@hanbang/design-tokens";
import {
  buildAmoraFirstHello,
  buildLoungeFirstRunView,
  FIRST_RUN_TUTORIAL_COLUMNS,
  isOnlyStageSuggestion,
  PREPARATION_STAGE_PROGRESS_KEY,
  PREPARATION_STAGE_VALUES,
  resolvePlanningChecklistStatus,
  shouldShowFirstRunTutorial,
  WEDDING_STYLE_OPTIONS,
  type PreparationStageValue,
  daysUntilWedding,
} from "@hanbang/shared";
import {
  getChecklistCategoryDueDday,
  mergePlanningChecklist,
} from "@hanbang/shared/utils";
import { supabase } from "@/lib/supabase";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import {
  calculateChecklistCounts,
  calculateChecklistProgress,
  formatLocalDateKey,
} from "@/lib/dashboardExperience.mjs";
import { isActiveScheduleEvent } from "@/lib/scheduleMutation.mjs";
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
  buildJoinedPlanHandoffView,
  hasJoinedPlanMarker,
  JOINED_PLAN_PARAM,
  resolveJoinedPlanSlot,
} from "@/lib/joinedPlanHandoff";
import {
  dismissAmoraFirstHelloBubble,
  peekPendingAmoraFirstHello,
  rememberPendingAmoraFirstHello,
} from "@/lib/amoraFirstHello";
import ErrorRetry from "@/components/ErrorRetry";
import TodayOneCareCard from "@/components/dashboard/TodayOneCareCard";
import AmoraActionsCard from "@/components/lounge/AmoraActionsCard";
import PartnerChangeNotice from "@/components/lounge/PartnerChangeNotice";
import WeddingHomeExperience, {
  LoungeProfileButton,
  type WeddingHomeData,
} from "@/components/dashboard/WeddingHomeExperience";
import {
  buildLoungeAmoraAskHref,
  stageLoungeAmoraAsk,
  type LoungeAmoraTask,
} from "@/lib/loungeAmoraAsk";
import AmoraFab from "@/components/lounge/AmoraFab";
import JoinedPlanHandoff from "@/components/lounge/JoinedPlanHandoff";
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
  /** 저장된 식장. 합류 직후 안내의 "장소" 칸이 되읽는다. 없으면 null. */
  venue: string | null;
  /** 체크리스트 항목 수. 히어로의 %와 같은 셈이고, 합류 안내가 "n/m개 체크"로 보여준다. */
  checklistDone: number;
  checklistTotal: number;
  progress: Record<string, unknown>;
  urgentTasks: UrgentTask[];
  bookingOutcomeTasks: BookingOutcomeTask[];
  partnerActivity: PartnerActivity | null;
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
  /**
   * 위 확인이 끝났는가(결과가 undefined여도 끝난 것이다). 합류 직후에는 이 값이 true가 되기
   * 전까지 환영 자리를 비워 두고 첫 실행 안내도 판정하지 않는다 — `resolveJoinedPlanSlot` 참고.
   */
  partnerLinkedChecked: boolean;
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

// 예식일은 사용자가 고른 **한국 날짜**다. 기기 시간대로 오늘을 읽으면
// 해외에 있을 때 채팅(서버·KST)과 이 화면이 서로 다른 D-day 를 말한다.
//
// 웹은 2026-08-25 에 서버 계산을 `daysUntilWedding`(KST 고정)으로 통일했다.
// 모바일 화면 세 곳은 각자 `calcDday` 를 갖고 있었고 파싱 방식마저 서로
// 달랐다(하나는 날짜만 있는 문자열을 UTC 자정으로 읽었다).
function calcDday(dateStr: string | null): number | null {
  return daysUntilWedding(dateStr, Date.now());
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

    // 게이트가 둘이었고 **둘 다 저장값만 봤다.** 위는 저장된 status를, 아래 `allDone`은
    // 저장된 배열만 보고 템플릿과 병합하지 않았다. 그래서 항목이 늘면 열한 개를 끝낸
    // 분야가 양쪽에서 걸러져 열두 번째 항목이 긴급 목록에 영영 안 뜬다. 모바일은 그
    // 분야를 한 번 열어야 저장값이 갱신되는데, 여기서 숨기면 열 계기조차 없다.
    //
    // 두 게이트를 리졸버 하나로 합친다. 항목 기록이 있으면 병합본에서 파생하고, 없으면
    // 저장된 선언을 그대로 둔다. `checklist`의 원소는 `label`이 없지만 판정에 쓰이는
    // 것은 `id`와 `done`뿐이다.
    const resolvedStatus = resolvePlanningChecklistStatus(
      category.items,
      categoryProgress as unknown as Parameters<typeof resolvePlanningChecklistStatus>[1],
    );
    if (resolvedStatus === "completed" || resolvedStatus === "not_applicable") continue;

    // 아래는 체크리스트 배열이 없는 **옛 플랫 불리언 모양**만 남긴다. 운영 데이터에 이
    // 모양이 남아 있는지 확인하지 못해 지우지 않았다.
    let allDone = false;
    if (
      !Array.isArray(categoryProgress?.checklist)
      && categoryProgress && typeof categoryProgress === "object"
    ) {
      const booleanValues = Object.values(categoryProgress).filter(
        (value): value is boolean => typeof value === "boolean",
      );
      allDone =
        booleanValues.length > 0
        && booleanValues.every((value) => value === true);
    }
    if (allDone) continue;

    // 기본 확인 시점은 분야 값(`ddayDeadline`) 하나가 아니라 **아직 안 끝낸 항목 중 가장 이른
    // 시점**으로 센다. 분야 값으로만 세면 늦게 하는 항목(결혼식 직전 최종으로 입어 보기 등)만
    // 남은 커플도 라운지에서 "기본 확인 시점에서 N일 지남"을 봤고, 같은 커플이 체크리스트
    // 화면(`buildWeeklyChecklistActions`)에서는 그 경고를 보지 않았다. 병합은 체크리스트 화면과
    // 같다 — 저장된 배열이 있으면 그것을, 없으면 옛 플랫 불리언을 항목으로 읽어 템플릿과 합친다.
    const savedChecklist = Array.isArray(categoryProgress?.checklist)
      ? categoryProgress.checklist.map((item) => ({
          id: item.id,
          label: category.items.find((templateItem) => templateItem.id === item.id)?.label ?? "이전 준비 항목",
          done: item.done === true,
        }))
      : Object.entries(categoryProgress ?? {})
          .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
          .map(([id, done]) => ({
            id,
            label: category.items.find((templateItem) => templateItem.id === id)?.label ?? "이전 준비 항목",
            done,
          }));
    const mergedChecklist = mergePlanningChecklist(category.items, savedChecklist);
    const due = getChecklistCategoryDueDday(category, mergedChecklist);
    // 남은 일이 전부 계약·약속으로 정한 날에 하는 일이면 앱이 그 날을 모른다. 체크리스트 화면·웹 임박 알림도 뺀다.
    if (due === null) continue;

    const remainingDays = dday - due;
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
      ddayDeadline: due,
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

/**
 * 이 커플이 남긴 상담 요청 기록이 하나라도 있는가.
 *
 * 업체 상담·예약 요청은 2026-07-15부터 받지 않는다. 그래서 라운지의 「상담 요청 기록」 칸은
 * 이미 기록이 있는 사람에게만 **지난 기록을 보는 입구**로 남긴다(2026-09-18 파운더 결정).
 * 상태로 거르지 않는다 — 취소 표시만 남은 사람도 그 기록을 볼 수 있어야 한다.
 * 못 물어봤으면 false다. 틀린 입구가 뜨는 것보다 잠깐 없는 편이 낫고, 새로고침이 다시 묻는다.
 */
async function loadHasBookingRecords(coupleId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("vendor_bookings")
      .select("id")
      .eq("couple_id", coupleId)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
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
      recentCategories.push(category.label);
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
  // 파트너 합류 직후에만 온보딩이 `?joined=1`을 붙여 보낸다. 표시는 이 파라미터뿐이고
  // 어디에도 저장하지 않는다 — 앱을 다시 켜면 "방금 합류했다"도 사라진다.
  const routeParams = useLocalSearchParams();
  const joinedPlanMarker = hasJoinedPlanMarker(routeParams[JOINED_PLAN_PARAM]);
  // loadData는 화면이 살아 있는 동안 한 번 만들어지므로(리얼타임 구독이 붙잡는다) 표시는
  // 렌더마다 ref로 넘긴다. 첫 실행 안내를 상대 확인 뒤로 미룰지 여기서 읽는다.
  const joinedPlanMarkerRef = useRef(joinedPlanMarker);
  joinedPlanMarkerRef.current = joinedPlanMarker;
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [careRefreshVersion, setCareRefreshVersion] = useState(0);
  const [error, setError] = useState(false);
  const [firstRunTutorialOpen, setFirstRunTutorialOpen] = useState(false);
  const [amoraBubble, setAmoraBubble] = useState<string | null>(null);
  // 말풍선을 닫는 것과 첫마디를 읽는 것은 다른 일이다. 말풍선을 X로 접었다고 점까지 지우면,
  // 아모라가 남긴 말이 대화에 기다린다는 표시가 화면에서 통째로 사라진다.
  const [amoraUnread, setAmoraUnread] = useState(false);
  const coupleIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
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
    try {
      setError(false);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
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

      coupleIdRef.current = profile.couple_id ?? null;
      const onboardingCompleted = profile.onboarding_completed === true;

      if (!profile.couple_id) {
        firstRunProfileRef.current = {
          userId: user.id,
          coupleId: null,
          weddingDate: null,
          preparationStage: null,
        };
        setData({
          name: profile.name ?? null,
          weddingDate: null,
          totalBudget: 0,
          venue: null,
          checklistDone: 0,
          checklistTotal: 0,
          progress: {},
          progressPercent: 0,
          todayTasks: [],
          dday: null,
          urgentTasks: [],
          bookingOutcomeTasks: [],
          partnerActivity: null,
          hasBookingRecords: false,
          coupleId: null,
          preparationStage: null,
          weddingStyleLabel: null,
          partnerLinked: undefined,
          // 커플이 없으면 물어볼 상대도 없다. 기다릴 것이 없다.
          partnerLinkedChecked: true,
        });
        void evaluateFirstRunTutorial(user.id, onboardingCompleted);
        return;
      }

      const { data: journey, error: journeyError } = await supabase
        .from("wedding_journeys")
        .select("wedding_date, venue, total_budget, progress")
        .eq("couple_id", profile.couple_id)
        .single();
      if (journeyError) throw journeyError;

      const progress =
        (journey.progress as Record<string, unknown> | null) ?? {};
      const progressPercent = calculateChecklistProgress(
        progress,
        CATEGORY_CHECKLISTS,
      );
      const checklistCounts = calculateChecklistCounts(
        progress,
        CATEGORY_CHECKLISTS,
      );
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

      const coreData: DashboardData = {
        name: profile.name,
        weddingDate,
        totalBudget: journey.total_budget ?? 0,
        venue: typeof journey.venue === "string" ? journey.venue : null,
        checklistDone: checklistCounts.done,
        checklistTotal: checklistCounts.total,
        progress,
        progressPercent,
        todayTasks,
        dday,
        urgentTasks: calcUrgentTasks(dday, progress),
        bookingOutcomeTasks: [],
        partnerActivity: null,
        hasBookingRecords: false,
        coupleId: profile.couple_id,
        preparationStage: readPreparationStage(progress),
        weddingStyleLabel: readWeddingStyleLabel(progress),
        // 상대가 있는지는 질의가 한 번 더 필요해서 아래에서 이어 붙인다. 그동안은 undefined라
        // 초대 카드가 뜨지 않는다 — 없는 카드가 늦게 뜨는 편이, 틀린 카드가 먼저 뜨는 것보다 낫다.
        partnerLinked: undefined,
        partnerLinkedChecked: false,
      };

      firstRunProfileRef.current = {
        userId: user.id,
        coupleId: profile.couple_id,
        weddingDate,
        preparationStage: readPreparationStage(progress),
      };

      // 라운지의 핵심 맥락과 오늘의 행동을 먼저 그린 뒤, 보조 데이터를 이어 붙인다.
      //
      // 같은 커플을 다시 읽는 중(리얼타임 갱신·당겨서 새로고침)이면 상대 유무와 기록 유무는
      // 방금 확인한 값을 새 값이 올 때까지 들고 있는다. 매번 비웠다 채우면 합류 안내와
      // 「상담 요청 기록」 칸이 상대가 무언가 고칠 때마다 깜빡이고 격자가 다시 흐른다.
      setData((current) =>
        current && current.coupleId === coreData.coupleId
          ? {
              ...coreData,
              partnerLinked: current.partnerLinked,
              partnerLinkedChecked: current.partnerLinkedChecked,
              hasBookingRecords: current.hasBookingRecords,
            }
          : coreData,
      );
      setLoading(false);
      setRefreshing(false);

      // 화면이 그려진 뒤에 안내를 판정한다. 앵커가 아직 없는 화면 위에 안내를 띄우면
      // 모든 단계가 "못 잡았다"로 건너뛰어진다.
      //
      // 방금 합류한 사람(`?joined=1`)은 상대 확인이 끝난 뒤로 미룬다. 확인이 끝나야 합류 안내가
      // 자리를 잡는데, 안내는 각 단계의 자리를 한 번만 잰다 — 먼저 재면 합류 안내가 끼어든 뒤
      // "여기부터 보시면 돼요"가 엉뚱한 곳을 짚는다. 합류하지 않은 사람은 예전처럼 바로 판정한다.
      const waitForPartnerCheck = joinedPlanMarkerRef.current;
      if (!waitForPartnerCheck) {
        void evaluateFirstRunTutorial(user.id, onboardingCompleted);
      }

      try {
        const [bookingOutcomeTasks, partnerActivity, partnerLinked, hasBookingRecords] =
          await Promise.all([
            loadBookingOutcomeTasks(profile.couple_id),
            loadPartnerActivity({
              coupleId: profile.couple_id,
              userId: user.id,
              progress,
            }),
            loadPartnerLinked(profile.couple_id, user.id),
            loadHasBookingRecords(profile.couple_id),
          ]);

        setData((current) =>
          current
            ? {
                ...current,
                bookingOutcomeTasks,
                partnerActivity,
                partnerLinked,
                partnerLinkedChecked: true,
                hasBookingRecords,
              }
            : current,
        );
      } catch (auxiliaryError) {
        // 보조 데이터가 실패해도 "상대 확인은 끝났다(모름)"는 남긴다. 그러지 않으면 합류 자리가
        // 기다리는 중에 멈춰 첫 도착 카드가 다시 나오지 않는다.
        setData((current) =>
          current ? { ...current, partnerLinkedChecked: true } : current,
        );
        throw auxiliaryError;
      } finally {
        if (waitForPartnerCheck) {
          void evaluateFirstRunTutorial(user.id, onboardingCompleted);
        }
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [evaluateFirstRunTutorial]);

  useEffect(() => {
    let active = true;

    loadData().then(() => {
      if (!active) return;
      const coupleId = coupleIdRef.current;
      if (!coupleId) return;

      const channel = supabase
        .channel(`dashboard:${coupleId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "wedding_journeys",
            filter: `couple_id=eq.${coupleId}`,
          },
          loadData,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "vendor_bookings",
            filter: `couple_id=eq.${coupleId}`,
          },
          loadData,
        )
        .subscribe();

      channelRef.current = channel;
    });

    return () => {
      active = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setCareRefreshVersion((version) => version + 1);
  }, [loadData]);

  // 안내를 마친 뒤 앱이 꺼졌다 켜져도 아모라의 첫마디는 기다리고 있어야 한다.
  // 완료 사실은 이미 프로필에 적혀서 안내는 다시 뜨지 않으므로, 여기서 되살리지 않으면
  // 그 사람은 "먼저 말을 거는 아모라"를 영영 만나지 못한다.
  useEffect(() => {
    let active = true;
    setAmoraBubble(null);
    setAmoraUnread(false);
    const owner = firstRunProfileRef.current;
    if (!owner || !data || owner.coupleId !== data.coupleId) return;
    void (async () => {
      const pending = await peekPendingAmoraFirstHello({ storage: AsyncStorage, owner });
      if (!active || !pending || firstRunProfileRef.current !== owner) return;
      // 아직 대화에서 소비되지 않은 첫마디가 있다 = 아직 안 읽었다. 말풍선을 접었더라도
      // 점은 남아야 "아모라가 뭔가 남겼다"가 화면에 남는다.
      setAmoraUnread(true);
      if (pending.bubbleDismissed) return;
      setAmoraBubble(pending.preview);
    })();
    return () => {
      active = false;
    };
  }, [data]);

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
      if (firstRunProfileRef.current !== context) return;
      const hello = buildAmoraFirstHello({
        weddingDate: context.weddingDate,
        preparationStage: context.preparationStage,
        partnerLinked,
        now: Date.now(),
      });

      await rememberPendingAmoraFirstHello(hello, { storage: AsyncStorage, owner: context });
      if (firstRunProfileRef.current !== context) return;
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

  /**
   * 라운지 맨 앞 환영 자리. 합류 직후 안내는 웹과 같은 조건이다 — 합류 표시가 있고, 상대가
   * 실제로 들어와 있을 때. 합류 표시가 있는데 상대 확인이 아직 끝나지 않았으면("waiting")
   * 합류 안내도 첫 도착 카드도 두지 않는다 — 한 장을 먼저 그렸다가 바꿔 끼우지 않는다.
   */
  const joinedPlanSlot = data?.coupleId
    ? resolveJoinedPlanSlot({
        marker: joinedPlanMarker,
        partnerLinked: data.partnerLinked,
        partnerLinkedChecked: data.partnerLinkedChecked,
      })
    : "none";

  const joinedPlanHandoffView = useMemo(() => {
    if (!data || joinedPlanSlot !== "handoff") return null;
    return buildJoinedPlanHandoffView({
      weddingDate: data.weddingDate,
      venue: data.venue,
      totalBudget: data.totalBudget,
      checklistDone: data.checklistDone,
      checklistTotal: data.checklistTotal,
    });
  }, [data, joinedPlanSlot]);

  // 웹 카드의 "함께 확인할 내용 찾기"와 같은 문이다. 입력창에 웹과 같은 질문 초안만 놓고,
  // 보내는 것은 사람이 한다. 카드는 그대로 두어 돌아와도 같은 요약을 다시 볼 수 있다.
  const handleReviewJoinedPlan = useCallback(() => {
    router.push("/(tabs)/chat?entry=joined_plan_review");
  }, []);

  // "이 내용 확인했어요"는 표시를 지우는 것이 전부다. 아무것도 저장하지 않는다.
  const handleDismissJoinedPlan = useCallback(() => {
    router.setParams({ [JOINED_PLAN_PARAM]: undefined });
  }, []);

  const handleAmoraFabPress = useCallback(() => {
    // 말풍선은 눌리면 사라지고 다시 뜨지 않는다. 첫마디 자체는 대화 화면이 가져간다.
    setAmoraBubble(null);
    // 대화로 들어가는 순간이 곧 읽는 순간이다.
    setAmoraUnread(false);
    // 진입구마다 다른 맥락을 들고 간다. 라운지의 버튼에서 왔다는 것만으로도 대화 첫 줄이
    // 달라져야, 네 개의 문이 같은 빈 화면으로 떨어지지 않는다.
    router.push("/(tabs)/chat?entry=lounge_fab");
  }, []);

  // 할 일을 아모라에게 넘긴다(2026-11-13 파운더 결정: 기능은 아모라 뒤로). 질문 문장은 앱 안에서
  // 한 번 건네고 주소에는 번호만 싣는다(`@/lib/loungeAmoraAsk`). 대화 화면은 입력칸에 넣기만 하고,
  // 보내는 것은 사람이다.
  const handleAskAmora = useCallback((task: LoungeAmoraTask) => {
    const ownerId = firstRunProfileRef.current?.userId ?? null;
    const id = ownerId ? stageLoungeAmoraAsk({ ownerId, task }) : null;
    if (id === null) {
      Alert.alert("질문을 준비하지 못했어요", "라운지를 아래로 당겨 새로 고친 뒤 다시 눌러 주세요.");
      return;
    }
    router.push(buildLoungeAmoraAskHref(id) as Parameters<typeof router.push>[0]);
  }, []);

  const handleDismissAmoraBubble = useCallback(() => {
    // 접는 것은 "알림 봤다"이지 "첫마디 필요 없다"가 아니다. 점은 그대로 둔다.
    setAmoraBubble(null);
    void dismissAmoraFirstHelloBubble({ storage: AsyncStorage, owner: firstRunProfileRef.current });
  }, []);

  if (error && !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        {/* 하단 탭에 내 정보가 없다(2026-11-13). 라운지를 못 불러와도 설정·로그아웃으로 갈 수 있어야 한다. */}
        <View style={styles.errorHeader}>
          <LoungeProfileButton />
        </View>
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
      <FirstRunAnchorProvider>
        <WeddingHomeExperience
          data={data}
          loading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
          partnerChanges={<PartnerChangeNotice refreshVersion={careRefreshVersion} />}
          joinedPlanHandoff={
            joinedPlanHandoffView ? (
              <JoinedPlanHandoff
                view={joinedPlanHandoffView}
                onReview={handleReviewJoinedPlan}
                onDismiss={handleDismissJoinedPlan}
              />
            ) : null
          }
          todayOneCare={<TodayOneCareCard refreshVersion={careRefreshVersion} />}
          amoraActions={<AmoraActionsCard refreshVersion={careRefreshVersion} />}
          // 합류 안내가 떠 있을 때는 첫 도착 카드를 접는다 — 환영 카드 두 장이 겹치면 어느
          // 쪽이 지금 할 일인지 흐려진다(웹과 같다). 안내를 닫으면 다시 나온다. 상대 확인을
          // 기다리는 동안에도 접어 둔다 — 먼저 보였다가 합류 안내로 뒤바뀌지 않게.
          firstArrival={
            joinedPlanSlot === "none" && firstArrivalView ? (
              <LoungeFirstArrival view={firstArrivalView} />
            ) : null
          }
          emptyNote={
            firstArrivalView ? (
              <LoungeEmptyNote note={firstArrivalView.emptyNote} />
            ) : null
          }
          onAskAmora={handleAskAmora}
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
  // 머리줄의 내 정보 버튼과 같은 자리(오른쪽 위)에 둔다.
  errorHeader: {
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
});
