// 홈 탭 — 로그인한 커플의 첫 화면(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해).
//
// 화면은 예시 커플과 같은 `InvitationHome`(`Home.dc`)이고 모델은 `GET /api/invitation/home` 이 준다.
// 온보딩을 마쳤는데 조건(희망 달·지역·하객 수)이 비어 있으면 홈 대신 첫 대화(`InvitationFirstChat`,
// `Chat.dc`)를 보이고, 고른 값은 사람이 "좋아요"를 누를 때만 `PATCH /api/invitation/conditions` 로 저장한다.
// 온보딩 단계 자체(계정·커플 연결·동의)는 그대로다. 이미 쓰던 커플 대부분은 지역·하객 수가 비어 있으므로 첫 대화에
// 갇히지 않게 "나중에 할게요"로 홈에 가고, 그 선택은 사람마다 이 기기에 기억한다(`firstChatSkip.mjs`, 저장소가
// 실패하면 홈을 연다). 조건이 비어 있는 동안 홈의 "두 분이 정할 것" 맨 앞 한 줄이 첫 대화를 다시 연다. 하단 메뉴는
// 첫 대화 동안에도 그대로 쓸 수 있다(첫 대화가 유일한 길이 아니다).
//
// 예전 라운지가 맡던 일 가운데 제품·안전 몫은 남긴다(2026-11-17 리드 지시). 홈의 알림 자리(첫 장 아래,
// 아모라 소식 위)에 둔다. 할 말이 없으면 각 알림이 아무것도 그리지 않아 자리도 생기지 않는다.
//   - 상대가 바꾼 것(PartnerChangeNotice) · 합류 직후 안내(JoinedPlanHandoff)
//   - 첫 도착 안내와 초대 코드로 가는 카드(LoungeFirstArrival, 초대 카드는 아직 혼자일 때만)
//   - 오늘의 한 가지(TodayOneCareCard): 설정에서 켠 사람에게만 보인다. 켤 수 있는 설정이 남아 있는 한
//     보이는 자리도 있어야 한다(설정이 없는 기능을 약속하지 않는다).
//   - 첫 실행 안내(FirstRunCoachMarks)와 아모라의 첫마디(AmoraFab 말풍선). 버튼은 아모라가 먼저 건넨
//     말이 있거나 안내가 그 버튼을 가리킬 때만 메뉴 위에 뜬다.
//   - 지난 상담 요청 기록으로 가는 줄(LoungeRecordsEntry): 기록이 있는 커플에게만(2026-09-18 파운더 결정).
// 내 정보(설정·로그아웃·탈퇴)는 오른쪽 위 머리글자 묶음에서 연다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { invitationPalette } from "@hanbang/design-tokens";
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
import {
  ACTIVITY_COPY,
  ASK_CONDITIONS_COPY,
  FIRST_CHAT_COPY,
  HOME_STATE_COPY,
  INVITATION_REGIONS,
  type FirstChatModel,
  type InvitationConditionsResponse,
  type InvitationHomeResponse,
  type InvitationRouteKey,
  type PreparationStartStage,
} from "@hanbang/shared/invitation";
import { supabase } from "@/lib/supabase";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import {
  calculateChecklistCounts,
  formatLocalDateKey,
} from "@/lib/dashboardExperience.mjs";
import {
  hasCoupleMadeData,
  readRecordedCategoryStatuses,
  readWeddingStyleValue,
} from "@/lib/loungeFirstArrival.mjs";
import {
  hasShownFirstRunTutorialOnDevice,
  LOUNGE_CONTENT_BOTTOM_PADDING,
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
import {
  firstChatConditionsPatch,
  firstChatYearForMonth,
  kstYearMonth,
} from "@/lib/invitationApi.mjs";
import { hasSkippedFirstChat, rememberFirstChatSkip } from "@/lib/firstChatSkip.mjs";
import { navigateInvitationRoute } from "@/lib/invitationRoutes.mjs";
import { useLiveOwner } from "@/lib/invitationLive";
import ErrorRetry from "@/components/ErrorRetry";
import TodayOneCareCard from "@/components/dashboard/TodayOneCareCard";
import PartnerChangeNotice from "@/components/lounge/PartnerChangeNotice";
import { LoungeProfileButton } from "@/components/dashboard/WeddingHomeExperience";
import AmoraFab from "@/components/lounge/AmoraFab";
import JoinedPlanHandoff from "@/components/lounge/JoinedPlanHandoff";
import { FirstRunAnchorProvider } from "@/components/lounge/FirstRunAnchors";
import FirstRunCoachMarks, {
  type FirstRunCoachMarksOutcome,
} from "@/components/lounge/FirstRunCoachMarks";
import LoungeFirstArrival from "@/components/lounge/LoungeFirstArrival";
import InvitationHome from "@/components/invitation/InvitationHome";
import InvitationFirstChat from "@/components/invitation/InvitationFirstChat";
import InvitationStateScreen from "@/components/invitation/InvitationStateScreen";
import LoungeRecordsEntry from "@/components/invitationLive/LoungeRecordsEntry";
import AmoraTasksCard from "@/components/amoraTasks/AmoraTasksCard";

interface BookingOutcomeTask {
  id: string;
  vendorName: string;
  categoryLabel: string;
  bookingDate: string;
  isPast: boolean;
}

/**
 * 홈 바깥의 알림·안내가 읽는 이 커플의 사실. 홈 모델 자체는 서버(`/api/invitation/home`)가 만든다.
 * 첫 도착 안내·합류 안내·아모라 첫마디는 이 값으로만 만든다(모델이 쓰지 않는다).
 */
interface LoungeData {
  name: string | null;
  weddingDate: string | null;
  totalBudget: number;
  /** 저장된 식장. 합류 직후 안내의 "장소" 칸이 되읽는다. 없으면 null. */
  venue: string | null;
  /** 체크리스트 항목 수. 합류 안내가 "n/m개 체크"로 보여준다. */
  checklistDone: number;
  checklistTotal: number;
  progress: Record<string, unknown>;
  bookingOutcomeTasks: BookingOutcomeTask[];
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
  /** 온보딩을 마쳤는가. 마치지 않은 사람에게는 첫 대화(조건 묻기)도 첫 실행 안내도 띄우지 않는다. */
  onboardingCompleted: boolean;
  /**
   * 이 커플이 남긴 상담 요청 기록이 하나라도 있는가. 새 요청은 받지 않으므로, 기록이 있는
   * 사람에게만 지난 기록으로 가는 줄을 둔다. 모르면 없는 것으로 본다.
   */
  hasBookingRecords: boolean;
}

type InvitationState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; home: InvitationHomeResponse; conditions: InvitationConditionsResponse | null };

type FirstChatAnswers = {
  stage: PreparationStartStage | null;
  month: number | null;
  /** 사람이 이 화면에서 달을 직접 눌렀는가. 저장된 값을 되읽은 달은 다시 저장하지 않는다. */
  monthChosen: boolean;
  region: string | null;
  guests: number | null;
};

const EMPTY_ANSWERS: FirstChatAnswers = { stage: null, month: null, monthChosen: false, region: null, guests: null };

/**
 * 첫 대화의 지역 칩. 공유 지역 목록(`INVITATION_REGIONS`, 시·도 짧은 이름)에서만 고른다. 웨딩홀 자료의 지역과
 * 글자 그대로 맞춰 찾으므로 손으로 적은 지역을 받지 않는다. 목록이 비면 지역 칩을 그리지 않고 지역 없이도 저장한다.
 */
const FIRST_CHAT_REGIONS: readonly string[] = INVITATION_REGIONS;

/** 내 정보로 가는 머리글자 단추의 읽어 주는 이름. 예전 라운지 머리줄 단추(`LoungeProfileButton`)와 같은 말이다. */
const PROFILE_ACTION = {
  label: "내 정보",
  hint: "설정과 로그아웃도 여기서 열어요",
} as const;

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

/** 첫 도착 판정(`hasCoupleMadeData`)이 "두 사람이 만든 것"으로 세는 지난 요청 기록. */
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
 * 업체 상담·예약 요청은 2026-07-15부터 받지 않는다. 그래서 「상담 요청 기록」 줄은
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
 * 없을 수 있고(마이그레이션 미적용), 합쳐 두면 안내 플래그 하나 때문에 첫 화면 전체가
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

/**
 * 달을 아직 고르지 않았을 때 첫 대화 카드 위에 보일 연도. 고를 수 있는 달 가운데 가장 먼저 오는 달의
 * 연도다(그 달도 석 달 넘게 남는 해, `firstChatYearForMonth`). 달을 고르면 그 달의 연도로 바뀐다.
 */
function soonestFirstChatYear(today: { year: number; month: number }): number {
  const candidates = FIRST_CHAT_COPY.months.map((month) => ({ month, year: firstChatYearForMonth(month, today) }));
  candidates.sort((a, b) => a.year - b.year || a.month - b.month);
  return candidates[0]?.year ?? today.year;
}

function weddingYearMonth(weddingDate: string | null): { year: number; month: number } | null {
  const match = weddingDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(weddingDate) : null;
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

/** 첫 대화가 처음 열릴 때 이미 저장된 답을 되읽는다. 정한 예식일이 있으면 그 달이다. */
function answersFromConditions(response: InvitationConditionsResponse): FirstChatAnswers {
  const wedding = weddingYearMonth(response.weddingDate);
  return {
    stage: response.conditions.startStage,
    month: wedding?.month ?? response.conditions.hopedMonth,
    monthChosen: false,
    region: response.conditions.region,
    guests: response.conditions.guestCount,
  };
}

/**
 * 홈의 알림 자리. 순서는 예전 라운지와 같다: 상대가 바꾼 것, 합류 안내, 오늘의 한 가지, 첫 도착,
 * 그리고 지난 기록으로 가는 줄.
 */
function LoungeNotices({
  partnerChanges,
  joinedPlanHandoff,
  todayOneCare,
  firstArrival,
  records,
}: {
  partnerChanges: ReactNode;
  joinedPlanHandoff: ReactNode;
  todayOneCare: ReactNode;
  firstArrival: ReactNode;
  records: ReactNode;
}) {
  return (
    <>
      {partnerChanges}
      {joinedPlanHandoff}
      {todayOneCare}
      <AmoraTasksCard />
      {firstArrival}
      {records}
    </>
  );
}

export default function DashboardScreen() {
  // 파트너 합류 직후에만 온보딩이 `?joined=1`을 붙여 보낸다. 표시는 이 파라미터뿐이고
  // 어디에도 저장하지 않는다 — 앱을 다시 켜면 "방금 합류했다"도 사라진다.
  const routeParams = useLocalSearchParams();
  const joinedPlanMarker = hasJoinedPlanMarker(routeParams[JOINED_PLAN_PARAM]);
  // 웨딩홀 비교의 "조건 알려 주기"가 `?conditions=1` 로 첫 대화를 다시 연다(이번 실행에서 닫았어도).
  const askConditions = routeParams.conditions === "1";
  // loadData는 화면이 살아 있는 동안 한 번 만들어지므로(리얼타임 구독이 붙잡는다) 표시는
  // 렌더마다 ref로 넘긴다. 첫 실행 안내를 상대 확인 뒤로 미룰지 여기서 읽는다.
  const joinedPlanMarkerRef = useRef(joinedPlanMarker);
  joinedPlanMarkerRef.current = joinedPlanMarker;
  const liveOwner = useLiveOwner();
  const [data, setData] = useState<LoungeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [careRefreshVersion, setCareRefreshVersion] = useState(0);
  const [error, setError] = useState(false);
  const [invitation, setInvitation] = useState<InvitationState>({ status: "loading" });
  const [invitationVersion, setInvitationVersion] = useState(0);
  const [answers, setAnswers] = useState<FirstChatAnswers>(EMPTY_ANSWERS);
  const answersSeededRef = useRef(false);
  const [firstChatDismissed, setFirstChatDismissed] = useState(false);
  // 이 사람이 첫 대화를 "나중에 할게요"로 넘겼는가(이 기기에 사람마다 기억). 읽는 동안은 "checking".
  const [firstChatSkip, setFirstChatSkip] = useState<"checking" | "skipped" | "not_skipped">("checking");
  // 홈의 한 줄이나 웨딩홀 비교의 "조건 알려 주기"로 첫 대화를 직접 열었는가. 건너뛴 기록보다 앞선다.
  const [firstChatRequested, setFirstChatRequested] = useState(false);
  const [firstChatSaving, setFirstChatSaving] = useState(false);
  const [firstChatFailed, setFirstChatFailed] = useState(false);
  const [firstRunTutorialOpen, setFirstRunTutorialOpen] = useState(false);
  const [amoraBubble, setAmoraBubble] = useState<string | null>(null);
  // 말풍선을 닫는 것과 첫마디를 읽는 것은 다른 일이다. 말풍선을 X로 접었다고 점까지 지우면,
  // 아모라가 남긴 말이 대화에 기다린다는 표시가 화면에서 통째로 사라진다.
  const [amoraUnread, setAmoraUnread] = useState(false);
  // 대화 탭에서 첫마디를 읽고 돌아오면 버튼을 거둔다. 화면에 다시 올 때마다 남은 첫마디를 다시 본다.
  const [helloCheck, setHelloCheck] = useState(0);
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
          bookingOutcomeTasks: [],
          coupleId: null,
          preparationStage: null,
          weddingStyleLabel: null,
          partnerLinked: undefined,
          // 커플이 없으면 물어볼 상대도 없다. 기다릴 것이 없다.
          partnerLinkedChecked: true,
          onboardingCompleted,
          hasBookingRecords: false,
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
      const checklistCounts = calculateChecklistCounts(
        progress,
        CATEGORY_CHECKLISTS,
      );
      const weddingDate = journey.wedding_date ?? null;

      const coreData: LoungeData = {
        name: profile.name,
        weddingDate,
        totalBudget: journey.total_budget ?? 0,
        venue: typeof journey.venue === "string" ? journey.venue : null,
        checklistDone: checklistCounts.done,
        checklistTotal: checklistCounts.total,
        progress,
        bookingOutcomeTasks: [],
        coupleId: profile.couple_id,
        preparationStage: readPreparationStage(progress),
        weddingStyleLabel: readWeddingStyleLabel(progress),
        // 상대가 있는지는 질의가 한 번 더 필요해서 아래에서 이어 붙인다. 그동안은 undefined라
        // 초대 카드가 뜨지 않는다 — 없는 카드가 늦게 뜨는 편이, 틀린 카드가 먼저 뜨는 것보다 낫다.
        partnerLinked: undefined,
        partnerLinkedChecked: false,
        onboardingCompleted,
        hasBookingRecords: false,
      };

      firstRunProfileRef.current = {
        userId: user.id,
        coupleId: profile.couple_id,
        weddingDate,
        preparationStage: readPreparationStage(progress),
      };

      // 같은 커플을 다시 읽는 중(리얼타임 갱신·당겨서 새로고침)이면 상대 유무와 기록 유무는 방금 확인한
      // 값을 새 값이 올 때까지 들고 있는다. 매번 비웠다 채우면 합류 안내와 「상담 요청 기록」 줄이 상대가
      // 무언가 고칠 때마다 깜빡인다.
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
        const [bookingOutcomeTasks, partnerLinked, hasBookingRecords] = await Promise.all([
          loadBookingOutcomeTasks(profile.couple_id),
          loadPartnerLinked(profile.couple_id, user.id),
          loadHasBookingRecords(profile.couple_id),
        ]);

        setData((current) =>
          current
            ? {
                ...current,
                bookingOutcomeTasks,
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

  // 상대가 함께 쓰는 계획을 고치면(리얼타임) 바깥 사실과 홈 모델을 함께 다시 읽는다.
  const handleRemoteChange = useCallback(() => {
    void loadData();
    setInvitationVersion((version) => version + 1);
  }, [loadData]);

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
          handleRemoteChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "vendor_bookings",
            filter: `couple_id=eq.${coupleId}`,
          },
          handleRemoteChange,
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
  }, [loadData, handleRemoteChange]);

  // 홈 모델과 조건은 서버가 이 커플의 공유 계획에서 만든다(`/api/invitation/home`·`/conditions`).
  // 요청은 시작 시점 사용자에게 묶여 있다(`useLiveOwner`). 다시 읽다 실패하면 보던 홈을 그대로 둔다.
  useEffect(() => {
    if (liveOwner.status !== "ready") return;
    let active = true;
    void Promise.all([liveOwner.api.home(), liveOwner.api.conditions()]).then(([home, conditions]) => {
      if (!active) return;
      if (!home.ok) {
        setInvitation((current) => (current.status === "ready" ? current : { status: "failed" }));
        return;
      }
      setInvitation({ status: "ready", home: home.data, conditions: conditions.ok ? conditions.data : null });
    });
    return () => {
      active = false;
    };
  }, [liveOwner, invitationVersion]);

  const conditions = invitation.status === "ready" ? invitation.conditions : null;

  // 첫 대화가 처음 열릴 때 이미 저장된 답을 한 번만 되읽는다. 그 뒤로는 사람이 고른 값을 덮지 않는다.
  useEffect(() => {
    if (!conditions || answersSeededRef.current) return;
    answersSeededRef.current = true;
    setAnswers(answersFromConditions(conditions));
  }, [conditions]);

  // 건너뛴 기록은 사람마다다. 다른 사람으로 바뀌면 다시 읽는다. 저장소가 실패하면 건너뛴 것으로 본다(홈을 연다).
  useEffect(() => {
    if (liveOwner.status !== "ready") return;
    let active = true;
    setFirstChatSkip("checking");
    void hasSkippedFirstChat(AsyncStorage, liveOwner.ownerId).then((skipped) => {
      if (active) setFirstChatSkip(skipped ? "skipped" : "not_skipped");
    });
    return () => {
      active = false;
    };
  }, [liveOwner]);

  useEffect(() => {
    if (!askConditions) return;
    setFirstChatDismissed(false);
    setFirstChatRequested(true);
    router.setParams({ conditions: undefined });
  }, [askConditions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setInvitationVersion((version) => version + 1);
    await loadData();
    setCareRefreshVersion((version) => version + 1);
  }, [loadData]);

  useFocusEffect(useCallback(() => {
    setHelloCheck((value) => value + 1);
  }, []));

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
  }, [data, helloCheck]);

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
   * 커플이 없는 사람에게는 보여주지 않는다. 온보딩을 끝내지 못한 상태라 되읽어 줄 것도 없다.
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
   * 맨 앞 환영 자리. 합류 직후 안내는 웹과 같은 조건이다 — 합류 표시가 있고, 상대가
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
    // 진입구마다 다른 맥락을 들고 간다. 홈의 버튼에서 왔다는 것만으로도 대화 첫 줄이 달라진다.
    router.push("/(tabs)/chat?entry=lounge_fab");
  }, []);

  const handleDismissAmoraBubble = useCallback(() => {
    // 접는 것은 "알림 봤다"이지 "첫마디 필요 없다"가 아니다. 점은 그대로 둔다.
    setAmoraBubble(null);
    void dismissAmoraFirstHelloBubble({ storage: AsyncStorage, owner: firstRunProfileRef.current });
  }, []);

  const navigate = useCallback((route: InvitationRouteKey) => {
    navigateInvitationRoute(router, route, "tabs");
  }, []);

  // "나중에 할게요"(그리고 첫 대화의 뒤로): 홈을 열고 이 사람이 넘겼다는 것을 기억한다. 못 적어도 이번 실행 동안은 홈이다.
  const skipFirstChat = useCallback(() => {
    setFirstChatRequested(false);
    setFirstChatDismissed(true);
    setFirstChatSkip("skipped");
    if (liveOwner.status === "ready") void rememberFirstChatSkip(AsyncStorage, liveOwner.ownerId);
  }, [liveOwner]);

  // 홈의 "두 분이 정할 것" 맨 앞 줄: 첫 대화를 다시 연다.
  const openFirstChat = useCallback(() => {
    setFirstChatDismissed(false);
    setFirstChatRequested(true);
  }, []);

  const today = kstYearMonth(Date.now());
  const wedding = weddingYearMonth(conditions?.weddingDate ?? null);
  const firstChatYear = wedding?.year
    ?? (answers.month !== null && !answers.monthChosen && conditions?.conditions.hopedYear
      ? conditions.conditions.hopedYear
      : answers.month !== null
        ? firstChatYearForMonth(answers.month, today)
        : soonestFirstChatYear(today));

  const confirmFirstChat = useCallback(async () => {
    if (liveOwner.status !== "ready" || !conditions || firstChatSaving) return;
    const patch = firstChatConditionsPatch({
      ...answers,
      year: firstChatYear,
      weddingDateKnown: wedding !== null,
    });
    // 새로 고른 것이 없으면 저장할 것도 없다. 홈으로 간다.
    if (Object.keys(patch).length === 0) {
      setFirstChatDismissed(true);
      return;
    }
    setFirstChatSaving(true);
    setFirstChatFailed(false);
    const result = await liveOwner.api.saveConditions(patch);
    setFirstChatSaving(false);
    if (!result.ok) {
      setFirstChatFailed(true);
      return;
    }
    setInvitation((current) => (current.status === "ready" ? { ...current, conditions: result.data } : current));
    // 방금 답한 사람에게 같은 질문을 다시 띄우지 않는다(이번 실행 동안). 홈은 저장한 조건으로 다시 읽는다.
    setFirstChatDismissed(true);
    setInvitationVersion((version) => version + 1);
  }, [liveOwner, conditions, firstChatSaving, answers, firstChatYear, wedding]);

  if (error && !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        {/* 하단 메뉴에 내 정보가 없다. 홈을 못 불러와도 설정·로그아웃으로 갈 수 있어야 한다. */}
        <View style={styles.errorHeader}>
          <LoungeProfileButton />
        </View>
        <ErrorRetry
          message={HOME_STATE_COPY.loadFailed}
          onRetry={() => {
            setLoading(true);
            setInvitationVersion((version) => version + 1);
            loadData();
          }}
        />
      </SafeAreaView>
    );
  }

  if (invitation.status === "failed" && !loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        {/* 홈 모델을 못 받아도 설정·로그아웃으로 갈 수 있어야 한다. */}
        <View style={styles.errorHeader}>
          <LoungeProfileButton />
        </View>
        <ErrorRetry
          message={HOME_STATE_COPY.loadFailed}
          onRetry={() => {
            setInvitation({ status: "loading" });
            setInvitationVersion((version) => version + 1);
          }}
        />
      </SafeAreaView>
    );
  }

  if (loading || !data || invitation.status !== "ready" || firstChatSkip === "checking") {
    return <InvitationStateScreen busy />;
  }

  const home = invitation.home;
  // "무엇을 했나요?" 각 줄을 누가 했는지. 담당자가 한 일을 아모라가 한 것처럼 보이지 않게 한다(PHASE2).
  // 서버가 같은 줄을 같은 순서로 준다. 글이 어긋난 줄에는 꼬리표를 붙이지 않는다(짐작하지 않는다).
  const updateSteps = home.updateSteps ?? [];
  const stepActors = home.home.update?.steps.map((step, index) => (
    updateSteps[index]?.text === step ? ACTIVITY_COPY.actorLabel[updateSteps[index].actor] : null
  ));
  const conditionsMissing = (conditions?.missing.length ?? 0) > 0;
  const showFirstChat = data.onboardingCompleted
    && conditionsMissing
    && !firstChatDismissed
    && (firstChatRequested || firstChatSkip === "not_skipped");
  const showAmoraFab = firstRunTutorialOpen || amoraUnread || amoraBubble !== null;
  const firstChatModel: FirstChatModel = {
    year: firstChatYear,
    region: answers.region ?? "",
    guests: answers.guests ?? 0,
    names: { first: home.home.invitation.firstName, second: home.home.invitation.secondName },
  };

  return (
    <View style={styles.container}>
      {showFirstChat ? (
        <InvitationFirstChat
          model={firstChatModel}
          onBack={skipFirstChat}
          withTabBar
          onNavigate={navigate}
          live={{
            stage: answers.stage,
            month: answers.month,
            regions: FIRST_CHAT_REGIONS,
            region: answers.region,
            guests: answers.guests,
            onStage: (stage) => setAnswers((current) => ({ ...current, stage })),
            onMonth: (month) => setAnswers((current) => ({ ...current, month, monthChosen: true })),
            onRegion: (region) => setAnswers((current) => ({ ...current, region })),
            onGuests: (guests) => setAnswers((current) => ({ ...current, guests })),
            onConfirm: () => {
              void confirmFirstChat();
            },
            canConfirm: (answers.month !== null || wedding !== null)
              && answers.guests !== null
              && (FIRST_CHAT_REGIONS.length === 0 || answers.region !== null),
            saving: firstChatSaving,
            failed: firstChatFailed,
            onLater: skipFirstChat,
          }}
        />
      ) : (
        <FirstRunAnchorProvider>
          <InvitationHome
            model={home.home}
            onNavigate={navigate}
            withTabBar
            peopleAction={{ ...PROFILE_ACTION, onPress: () => router.push("/profile") }}
            // 못 읽었으면 그렇다고 말한다. 조건을 묻는 줄이 맨 앞에 있으면 "정할 것이 없어요"는 그 줄과 어긋나 빼 둔다.
            decisionsNote={home.degraded.includes("decisions")
              ? HOME_STATE_COPY.decisionsUnavailable
              : conditionsMissing ? null : HOME_STATE_COPY.noDecisions}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            bottomExtra={showAmoraFab ? LOUNGE_CONTENT_BOTTOM_PADDING : 0}
            stepActors={stepActors}
            // 조건이 비어 있는 동안 맨 앞에 "희망 시기와 지역 알려 주기"(함께) 한 줄. 누르면 첫 대화가 열린다.
            leadDecision={conditionsMissing ? {
              id: "ask-conditions",
              title: ASK_CONDITIONS_COPY.title,
              sub: ASK_CONDITIONS_COPY.sub,
              owner: { kind: "together" },
              onPress: openFirstChat,
            } : undefined}
            notices={
              <LoungeNotices
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
                // 합류 안내가 떠 있을 때는 첫 도착 카드를 접는다 — 환영 카드 두 장이 겹치면 어느
                // 쪽이 지금 할 일인지 흐려진다(웹과 같다). 안내를 닫으면 다시 나온다. 상대 확인을
                // 기다리는 동안에도 접어 둔다 — 먼저 보였다가 합류 안내로 뒤바뀌지 않게.
                firstArrival={
                  joinedPlanSlot === "none" && firstArrivalView ? (
                    <LoungeFirstArrival view={firstArrivalView} />
                  ) : null
                }
                records={data.hasBookingRecords ? <LoungeRecordsEntry /> : null}
              />
            }
          />
          {showAmoraFab ? (
            <AmoraFab
              onPress={handleAmoraFabPress}
              bubbleText={amoraBubble}
              unread={amoraUnread}
              onDismissBubble={handleDismissAmoraBubble}
            />
          ) : null}
          {firstRunTutorialOpen ? (
            <FirstRunCoachMarks onClose={handleFirstRunTutorialClose} />
          ) : null}
        </FirstRunAnchorProvider>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: invitationPalette.white,
  },
  // 홈 머리글자 자리(오른쪽 위)와 같은 곳에 내 정보 버튼을 둔다.
  errorHeader: {
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
});
