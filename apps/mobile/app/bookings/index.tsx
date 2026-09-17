// 아모라 내부 예약 요청 기록 목록
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from "react-native";
import { TextInput } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  Clock,
  FileCheck2,
  Star,
  Store,
  WalletCards,
  X,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";
import { supabase } from "@/lib/supabase";
import { apiFetchForExpectedUser } from "@/lib/api";
import { toKoreanErrorMessage } from "@/lib/errorCopy";
import {
  createOwnerCoupleSessionFence,
  type OwnerCoupleSessionToken,
} from "@/lib/ownerCoupleSessionFence.mjs";
import {
  AppHeader,
  AppText,
  EmptyState,
  IconBadge,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";
import {
  FeatureSummarySurface,
  SummaryPill,
  summaryColors,
} from "@/components/ui/FeatureSummary";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
type PillTone = "neutral" | "rose" | "success" | "warning" | "danger";

interface Booking {
  id: string;
  booking_date: string;
  booking_time: string | null;
  status: BookingStatus;
  amount: number | null;
  contracted_amount: number | null;
  actual_amount: number | null;
  vendor: { name: string; category: string | null } | null;
  product: { name: string; price: number | null } | null;
}

type TabKey = "all" | "upcoming" | "completed" | "cancelled";

interface BookingAction {
  label: string;
  title: string;
  description: string;
  tone: PillTone;
}

interface BookingOutcomeResponse {
  booking: {
    id: string;
    status: BookingStatus;
    amount: number | string | null;
    contracted_amount: number | string | null;
    actual_amount: number | string | null;
  };
  outcome: {
    extraAmount: number;
    baselineAmount: number;
  };
  message: string;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "upcoming", label: "다가옴" },
  { key: "completed", label: "지난 기록" },
  { key: "cancelled", label: "취소 표시" },
];

const STATUS_MAP: Record<BookingStatus, { label: string; tone: PillTone }> = {
  pending: { label: "요청 상태 기록", tone: "warning" },
  confirmed: { label: "확정 상태 기록", tone: "warning" },
  completed: { label: "완료 상태 기록", tone: "neutral" },
  cancelled: { label: "취소 표시 기록", tone: "danger" },
};

const CATEGORY_LABELS: Record<string, string> = {
  studio: PLANNING_CATEGORY_LABELS.studio,
  dress: PLANNING_CATEGORY_LABELS.dress,
  makeup: PLANNING_CATEGORY_LABELS.makeup,
  venue: PLANNING_CATEGORY_LABELS.venue,
  snap: PLANNING_CATEGORY_LABELS.snap,
  hanbok: PLANNING_CATEGORY_LABELS.hanbok,
  jewelry: PLANNING_CATEGORY_LABELS.ring,
  ring: PLANNING_CATEGORY_LABELS.ring,
  honeymoon: PLANNING_CATEGORY_LABELS.honeymoon,
  package: "묶음 상품",
  dvd: "결혼식 날 영상",
  suit: "예식 정장",
  invitation: PLANNING_CATEGORY_LABELS.invitation,
};

function normalizeStatus(status: unknown): BookingStatus {
  if (
    status === "confirmed" ||
    status === "completed" ||
    status === "cancelled" ||
    status === "pending"
  ) {
    return status;
  }
  return "pending";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBookingOutcomeResponse(
  value: unknown,
  expectedBookingId: string,
): BookingOutcomeResponse | null {
  if (
    !isRecord(value)
    || !isRecord(value.booking)
    || !isRecord(value.outcome)
    || typeof value.message !== "string"
    || value.message.length === 0
    || Array.from(value.message).length > 500
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.message)
    || typeof value.booking.id !== "string"
    || value.booking.id !== expectedBookingId
    || !(
      value.booking.status === "pending"
      || value.booking.status === "confirmed"
      || value.booking.status === "completed"
      || value.booking.status === "cancelled"
    )
    || typeof value.outcome.extraAmount !== "number"
    || !Number.isFinite(value.outcome.extraAmount)
    || typeof value.outcome.baselineAmount !== "number"
    || !Number.isFinite(value.outcome.baselineAmount)
    || value.outcome.extraAmount < 0
    || value.outcome.baselineAmount < 0
  ) return null;
  const amounts = [
    value.booking.amount,
    value.booking.contracted_amount,
    value.booking.actual_amount,
  ];
  if (amounts.some((amount) => amount !== null && readAmount(amount) === null)) {
    return null;
  }
  return value as unknown as BookingOutcomeResponse;
}

function bookingOutcomeError(value: unknown): string {
  if (
    isRecord(value)
    && typeof value.error === "string"
    && value.error.length > 0
    && Array.from(value.error).length <= 300
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.error)
  ) return value.error;
  return "예약 결과를 안전하게 저장하지 못했어요. 다시 시도해주세요.";
}

function formatWon(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만원`;
  if (n > 0) return `${n.toLocaleString()}원`;
  return "—";
}

function formatAmountInput(n: number | null | undefined): string {
  return n && n > 0 ? String(Math.round(n)) : "";
}

function readAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function parseAmountInput(value: string): number | null {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) return null;
  return amount;
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

function formatDate(dateStr: string): string {
  const d = parseBookingDate(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function formatDateLong(dateStr: string): string {
  const d = parseBookingDate(dateStr);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;
}

function categoryLabel(category: string | null | undefined): string {
  if (!category) return "카테고리 미정";
  return CATEGORY_LABELS[category] ?? category;
}

function bookingAmountLabel(booking: Booking): string {
  if (booking.actual_amount && booking.actual_amount > 0) {
    return `기록 지출 ${formatWon(booking.actual_amount)} · 사용자 입력(결제 증빙 아님)`;
  }
  if (booking.contracted_amount && booking.contracted_amount > 0) {
    return `계약 참고액 ${formatWon(booking.contracted_amount)} · 증빙 미확인`;
  }
  if (booking.amount && booking.amount > 0) {
    return `요청 참고액 ${formatWon(booking.amount)} · 견적·결제 증빙 아님`;
  }
  return "금액 확인 필요";
}

function isCompleted(booking: Booking, today = getTodayStart()): boolean {
  return booking.status === "completed" || parseBookingDate(booking.booking_date) < today;
}

function isUpcoming(booking: Booking, today = getTodayStart()): boolean {
  return (
    booking.status !== "cancelled" &&
    booking.status !== "completed" &&
    parseBookingDate(booking.booking_date) >= today
  );
}

function getDaysUntil(booking: Booking, today = getTodayStart()): number {
  const bookingDate = parseBookingDate(booking.booking_date);
  bookingDate.setHours(0, 0, 0, 0);
  return Math.ceil((bookingDate.getTime() - today.getTime()) / 86_400_000);
}

function compareByDateAsc(a: Booking, b: Booking): number {
  return parseBookingDate(a.booking_date).getTime() - parseBookingDate(b.booking_date).getTime();
}

function compareByDateDesc(a: Booking, b: Booking): number {
  return compareByDateAsc(b, a);
}

function getBookingAction(booking: Booking): BookingAction {
  if (booking.status === "cancelled") {
    return {
      label: "취소 표시 기록",
      title: "아모라 요청 기록 취소 표시",
      description: "취소 표시는 아모라 기록에만 적용돼요. 업체 취소·환불을 뜻하지 않아요.",
      tone: "danger",
    };
  }

  if (booking.status === "completed") {
    if (booking.actual_amount && booking.actual_amount > 0) {
      return {
        label: "완료 상태 기록",
        title: "완료 상태 · 기록 지출 있음",
        description: "사용자가 입력한 지출이 아모라 기록과 예산에 반영돼요. 결제 증빙을 뜻하지 않아요.",
        tone: "success",
      };
    }

    return {
      label: "완료 상태 기록",
      title: "완료 상태 · 지출 근거 미확인",
      description: "기존 완료 상태 기록은 유지했어요. 실제 진행과 지출은 직접 확인해 주세요.",
      tone: "warning",
    };
  }

  if (isCompleted(booking)) {
    return {
      label: "날짜 지남",
      title: "진행 여부 확인 필요",
      description: "날짜가 지났다는 사실만으로 완료된 것은 아니에요. 업체 진행 여부를 먼저 확인해 주세요.",
      tone: "warning",
    };
  }

  if (booking.status === "pending") {
    return {
      label: "요청 상태 기록",
      title: "업체 전달·확정 미확인",
      description: "아모라 안 요청 기록이에요. 업체에 가능 여부와 포함 항목·변경·환불 조건을 확인해 주세요.",
      tone: "warning",
    };
  }

  const daysUntil = getDaysUntil(booking);
  return {
    label: "확정 상태 기록",
    title: "업체 전달·확정 근거 미확인",
    description: daysUntil <= 7
      ? "기존 확정 상태 기록은 유지했어요. 업체 전달·확정 근거는 확인되지 않았어요. 날짜가 가까워 방문 시간·위치를 직접 확인해 주세요."
      : "기존 확정 상태 기록은 유지했어요. 업체 전달·확정 근거는 확인되지 않았어요. 방문 시간·위치와 업체 확정을 직접 확인해 주세요.",
    tone: "warning",
  };
}

export default function BookingsScreen() {
  const params = useLocalSearchParams<{ bookingId?: string | string[] }>();
  const requestedBookingId = Array.isArray(params.bookingId)
    ? params.bookingId[0]
    : params.bookingId;
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  const [sessionOwnerId, setSessionOwnerId] = useState<string | null>(null);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const openedBookingIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sessionFenceRef = useRef(createOwnerCoupleSessionFence()).current;
  const loadSequenceRef = useRef(0);

  const clearIdentityBoundState = useCallback((ownerId: string | null) => {
    setSessionOwnerId(ownerId);
    setCoupleId(null);
    setBookings([]);
    setSelectedBooking(null);
    setTab("all");
    openedBookingIdRef.current = null;
  }, []);

  const isOwnerCurrent = useCallback(async (
    sequence: number,
    ownerId: string,
  ) => {
    if (loadSequenceRef.current !== sequence) return false;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id.toLowerCase() === ownerId.toLowerCase()
      && loadSequenceRef.current === sequence;
  }, []);

  const isLoadCommitCurrent = useCallback(async (
    sequence: number,
    token: OwnerCoupleSessionToken,
  ) => {
    if (
      loadSequenceRef.current !== sequence
      || !sessionFenceRef.isCurrent(token)
    ) return false;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id.toLowerCase() === token.ownerId
      && loadSequenceRef.current === sequence
      && sessionFenceRef.isCurrent(token);
  }, [sessionFenceRef]);

  const loadData = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (loadSequenceRef.current !== sequence) return;
      const ownerId = sessionData.session?.user.id ?? null;
      const ownerChanged = sessionFenceRef.setOwner(ownerId);
      if (ownerChanged) clearIdentityBoundState(ownerId);
      if (!ownerId) {
        clearIdentityBoundState(null);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", ownerId)
        .single();
      if (!(await isOwnerCurrent(sequence, ownerId))) return;

      if (!profile?.couple_id) {
        sessionFenceRef.clearCouple(ownerId);
        clearIdentityBoundState(ownerId);
        return;
      }

      const coupleChanged = sessionFenceRef.setIdentity(
        ownerId,
        profile.couple_id,
      );
      if (coupleChanged) clearIdentityBoundState(ownerId);
      const token = sessionFenceRef.capture();
      if (!token || !(await isLoadCommitCurrent(sequence, token))) return;
      setSessionOwnerId(token.ownerId);
      setCoupleId(profile.couple_id);

      const { data, error } = await supabase
        .from("vendor_bookings")
        .select("id, booking_date, booking_time, status, amount, contracted_amount, actual_amount, vendor:vendors(name, category), product:vendor_products(name, price)")
        .eq("couple_id", profile.couple_id)
        .order("booking_date", { ascending: false });

      if (error) throw error;
      if (!(await isLoadCommitCurrent(sequence, token))) return;

      const nextBookings = (data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ""),
        booking_date: String(row.booking_date ?? ""),
        booking_time: row.booking_time ? String(row.booking_time) : null,
        status: normalizeStatus(row.status),
        amount: readAmount(row.amount),
        contracted_amount: readAmount(row.contracted_amount),
        actual_amount: readAmount(row.actual_amount),
        vendor: row.vendor as Booking["vendor"],
        product: row.product as Booking["product"],
      }));

      setBookings(nextBookings);
      setSelectedBooking((current) => (
        current ? nextBookings.find((booking) => booking.id === current.id) ?? null : current
      ));
    } catch (err) {
      if (loadSequenceRef.current === sequence) {
        console.error("Bookings load:", err);
      }
    } finally {
      if (loadSequenceRef.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [
    clearIdentityBoundState,
    isLoadCommitCurrent,
    isOwnerCurrent,
    sessionFenceRef,
  ]);

  useEffect(() => {
    let disposed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const ownerId = session?.user.id ?? null;
        if (!sessionFenceRef.setOwner(ownerId)) return;
        loadSequenceRef.current += 1;
        clearIdentityBoundState(ownerId);
        setLoading(true);
        setRefreshing(false);
        setTimeout(() => {
          if (!disposed) void loadData();
        }, 0);
      },
    );
    return () => {
      disposed = true;
      loadSequenceRef.current += 1;
      sessionFenceRef.setOwner(null);
      subscription.unsubscribe();
    };
  }, [clearIdentityBoundState, loadData, sessionFenceRef]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  useEffect(() => {
    if (!coupleId) return;

    const channel = supabase.channel(`bookings:${coupleId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "vendor_bookings",
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

  useEffect(() => {
    if (!requestedBookingId || openedBookingIdRef.current === requestedBookingId) return;

    const booking = bookings.find((item) => item.id === requestedBookingId);
    if (!booking) return;

    openedBookingIdRef.current = requestedBookingId;
    if (isCompleted(booking)) {
      setTab("completed");
    }
    setSelectedBooking(booking);
  }, [bookings, requestedBookingId]);

  const filtered = useMemo(() => {
    const today = getTodayStart();
    switch (tab) {
      case "upcoming":
        return bookings.filter((booking) => isUpcoming(booking, today)).sort(compareByDateAsc);
      case "completed":
        return bookings.filter((booking) => (
          booking.status !== "cancelled" && isCompleted(booking, today)
        )).sort(compareByDateDesc);
      case "cancelled":
        return bookings.filter((booking) => booking.status === "cancelled").sort(compareByDateDesc);
      default:
        return [...bookings].sort((a, b) => {
          const aUpcoming = isUpcoming(a, today);
          const bUpcoming = isUpcoming(b, today);
          if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
          return aUpcoming ? compareByDateAsc(a, b) : compareByDateDesc(a, b);
        });
    }
  }, [bookings, tab]);

  const summary = useMemo(() => {
    const today = getTodayStart();
    const upcoming = bookings
      .filter((booking) => isUpcoming(booking, today))
      .sort((a, b) => (
        parseBookingDate(a.booking_date).getTime() - parseBookingDate(b.booking_date).getTime()
      ));

    return {
      nextBooking: upcoming[0] ?? null,
      upcomingCount: upcoming.length,
      pendingCount: bookings.filter((booking) => booking.status === "pending").length,
      cancelledCount: bookings.filter((booking) => booking.status === "cancelled").length,
    };
  }, [bookings]);

  const nextAction = summary.nextBooking ? getBookingAction(summary.nextBooking) : null;

  function handleOutcomeSaved(
    updated: BookingOutcomeResponse["booking"],
    expectedIdentity: OwnerCoupleSessionToken,
  ) {
    if (!sessionFenceRef.isCurrent(expectedIdentity)) return;
    loadSequenceRef.current += 1;
    setLoading(false);
    setRefreshing(false);
    setBookings((current) =>
      current.map((booking) =>
        booking.id === updated.id
          ? {
              ...booking,
              status: updated.status,
              amount: readAmount(updated.amount),
              contracted_amount: readAmount(updated.contracted_amount),
              actual_amount: readAmount(updated.actual_amount),
            }
          : booking
      )
    );
    setSelectedBooking((current) =>
      current && current.id === updated.id
        ? {
            ...current,
            status: updated.status,
            amount: readAmount(updated.amount),
            contracted_amount: readAmount(updated.contracted_amount),
            actual_amount: readAmount(updated.actual_amount),
          }
        : current
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <AppHeader
          title="예약 요청 기록"
          subtitle="아모라 내부 기록 · 업체 전달·확정은 별도 확인"
          onBack={() => router.back()}
        />
        <LoadingState label="예약 요청 기록을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader
        title="예약 요청 기록"
        subtitle="아모라 내부 기록 · 업체 전달·확정은 별도 확인"
        onBack={() => router.back()}
      />

      <View style={s.tabRow}>
        {TABS.map((item) => (
          <Pressable
            key={item.key}
            style={[s.tab, tab === item.key && s.tabActive]}
            onPress={() => setTab(item.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === item.key }}
          >
            <AppText
              variant="caption"
              style={[s.tabText, tab === item.key && s.tabTextActive]}
            >
              {item.label}
            </AppText>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadData(); }}
            tintColor={colors.rose[500]}
          />
        }
      >
        {bookings.length > 0 ? (
          // 요약은 웹과 같은 샴페인 요약 면이다. 아래 요청 기록 카드와 구분되고, 반투명 흰 글자
          // (어두운 카드 위 62~78%)보다 읽기 쉽다.
          <FeatureSummarySurface style={s.summaryCard}>
            {summary.nextBooking && nextAction ? (
              <>
                <View style={s.summaryTop}>
                  <View style={s.summaryTitleBlock}>
                    <AppText variant="eyebrow" style={s.summaryEyebrow}>
                      REQUEST RECORD NEXT
                    </AppText>
                    <AppText variant="subtitle" style={s.summaryTitle} numberOfLines={2}>
                      {summary.nextBooking.vendor?.name ?? "업체 미정"}
                    </AppText>
                  </View>
                  <SummaryPill label={nextAction.label} tone={nextAction.tone} />
                </View>
                <AppText variant="body" style={s.summaryBody}>
                  {nextAction.description}
                </AppText>
                <View style={s.summaryMetaRow}>
                  <View style={s.summaryMeta}>
                    <CalendarDays size={15} color={summaryColors.label} />
                    <AppText variant="caption" style={s.summaryMetaText}>
                      {formatDateLong(summary.nextBooking.booking_date)}
                      {summary.nextBooking.booking_time ? ` ${summary.nextBooking.booking_time}` : ""}
                    </AppText>
                  </View>
                  <View style={s.summaryMeta}>
                    <WalletCards size={15} color={summaryColors.label} />
                    <AppText variant="caption" style={s.summaryMetaText}>
                      {bookingAmountLabel(summary.nextBooking)}
                    </AppText>
                  </View>
                </View>
              </>
            ) : (
              <>
                <AppText variant="eyebrow" style={s.summaryEyebrow}>
                  REQUEST RECORD REVIEW
                </AppText>
                <AppText variant="subtitle" style={[s.reviewTitle, s.summaryTitle]}>
                  다가오는 요청 기록은 없어요
                </AppText>
                <AppText variant="body" style={s.summaryBody}>
                  진행 여부와 지출을 직접 확인한 뒤 사용자 기록과 만족도를 남길 수 있어요. 입력값은 결제 증빙이 아니에요.
                </AppText>
              </>
            )}
            <View style={s.summaryStats}>
              <View style={s.statItem}>
                <AppText variant="bodyStrong" style={s.statNumber}>
                  {summary.upcomingCount}
                </AppText>
                <AppText variant="caption" style={s.statLabel}>다가옴</AppText>
              </View>
              <View style={s.statDivider} />
              <View style={s.statItem}>
                <AppText variant="bodyStrong" style={s.statNumber}>
                  {summary.pendingCount}
                </AppText>
                <AppText variant="caption" style={s.statLabel}>미확인</AppText>
              </View>
              <View style={s.statDivider} />
              <View style={s.statItem}>
                <AppText variant="bodyStrong" style={s.statNumber}>
                  {summary.cancelledCount}
                </AppText>
                <AppText variant="caption" style={s.statLabel}>취소 표시</AppText>
              </View>
            </View>
          </FeatureSummarySurface>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState
            icon={
              <IconBadge tone="ivory" size={52}>
                <CalendarCheck size={26} color={colors.taupe[500]} />
              </IconBadge>
            }
            title={bookings.length === 0 ? "예약 요청 기록이 없어요" : "이 조건의 요청 기록이 없어요"}
            description={
              bookings.length === 0
                ? "업체 상세에서 상담 날짜와 상품 후보를 고르면 아모라 내부 기록이 여기에 모여요. 업체 전달·확정은 별도예요."
                : "다른 상태 탭을 눌러 아모라 요청 기록을 확인해 보세요."
            }
            action={
              bookings.length === 0 ? (
                <PrimaryButton
                  tone="ghost"
                  icon={<Store size={18} color={colors.noir[800]} />}
                  onPress={() => router.push("/market-prices")}
                >
                  업체 탐색하기
                </PrimaryButton>
              ) : null
            }
          />
        ) : (
          <View style={s.list}>
            {filtered.map((booking) => {
              const action = getBookingAction(booking);
              const status = STATUS_MAP[booking.status];

              return (
                <Pressable
                  key={booking.id}
                  style={({ pressed }) => (pressed ? s.cardPressed : undefined)}
                  onPress={() => setSelectedBooking(booking)}
                  accessibilityRole="button"
                >
                  <Surface style={s.card}>
                    <View style={s.cardTop}>
                      <View style={s.cardTitleBlock}>
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {booking.vendor?.name ?? "업체 미정"}
                        </AppText>
                        <AppText variant="caption">
                          {categoryLabel(booking.vendor?.category)}
                        </AppText>
                      </View>
                      <StatusPill label={status.label} tone={status.tone} />
                    </View>

                    <AppText variant="body" numberOfLines={1}>
                      {booking.product?.name ?? "상품 미정"}
                    </AppText>

                    <View style={s.infoGrid}>
                      <View style={s.infoItem}>
                        <CalendarDays size={15} color={colors.textTertiary} />
                        <AppText variant="caption">
                          {formatDate(booking.booking_date)}
                          {booking.booking_time ? ` ${booking.booking_time}` : ""}
                        </AppText>
                      </View>
                      <View style={s.infoItem}>
                        <WalletCards size={15} color={colors.textTertiary} />
                        <AppText variant="caption">
                          {bookingAmountLabel(booking)}
                        </AppText>
                      </View>
                    </View>

                    <View style={s.actionRow}>
                      <View style={s.actionCopy}>
                        <AppText variant="bodyStrong">{action.title}</AppText>
                        <AppText variant="caption">{action.description}</AppText>
                      </View>
                      <ChevronRight size={17} color={colors.textTertiary} />
                    </View>
                  </Surface>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <BookingDetailSheet
        key={`${sessionOwnerId ?? "signed-out"}:${coupleId ?? "unlinked"}:${selectedBooking?.id ?? "closed"}`}
        booking={selectedBooking}
        identity={sessionFenceRef.capture()}
        onClose={() => setSelectedBooking(null)}
        onSaved={handleOutcomeSaved}
      />
    </SafeAreaView>
  );
}

function BookingDetailSheet({
  booking,
  identity,
  onClose,
  onSaved,
}: {
  booking: Booking | null;
  identity: OwnerCoupleSessionToken | null;
  onClose: () => void;
  onSaved: (
    booking: BookingOutcomeResponse["booking"],
    expectedIdentity: OwnerCoupleSessionToken,
  ) => void;
}) {
  const [actualAmountText, setActualAmountText] = useState("");
  const [contractedAmountText, setContractedAmountText] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [sharePublicReview, setSharePublicReview] = useState(false);
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!booking) return;
    setActualAmountText(formatAmountInput(booking.actual_amount));
    setContractedAmountText(formatAmountInput(booking.contracted_amount ?? booking.amount));
    setRating(null);
    setReviewText("");
    setSharePublicReview(false);
    setOutcomeError(null);
    setOutcomeMessage(null);
  }, [booking?.id]);

  if (!booking || !identity) return null;
  const expectedIdentity = identity;
  const expectedOwnerId = expectedIdentity.ownerId;

  const action = getBookingAction(booking);
  const status = STATUS_MAP[booking.status];
  const completed = booking.status !== "cancelled" && isCompleted(booking);
  const actualAmount = parseAmountInput(actualAmountText);
  const contractedAmount = parseAmountInput(contractedAmountText);
  const canSaveOutcome = completed && actualAmount !== null && rating !== null && !savingOutcome;

  async function saveOutcome() {
    if (!booking) return;
    if (actualAmount === null) {
      setOutcomeError("사용자가 확인한 기록 지출을 입력해 주세요.");
      return;
    }
    if (rating === null) {
      setOutcomeError("만족도를 선택해주세요.");
      return;
    }

    setSavingOutcome(true);
    setOutcomeError(null);
    setOutcomeMessage(null);
    try {
      const response = await apiFetchForExpectedUser(
        expectedOwnerId,
        `/api/bookings/${booking.id}/outcome`,
        {
          method: "PATCH",
          body: JSON.stringify({
            actualAmount,
            contractedAmount,
            rating,
            review: reviewText,
            sharePublicReview,
          }),
        }
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(bookingOutcomeError(payload));
      const result = parseBookingOutcomeResponse(payload, booking.id);
      if (!result) {
        throw new Error("예약 저장 응답을 안전하게 확인하지 못했어요. 다시 불러와 확인해주세요.");
      }
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id.toLowerCase() !== expectedOwnerId.toLowerCase()) return;
      onSaved(result.booking, expectedIdentity);
      setOutcomeMessage(
        result.outcome.extraAmount > 0
          ? `입력 기준 추가 지출 ${formatWon(result.outcome.extraAmount)}까지 사용자가 입력한 기록으로 저장했어요. 결제 증빙을 뜻하지 않아요.`
          : "사용자가 입력한 기록 지출로 저장했어요. 결제 증빙을 뜻하지 않아요."
      );
    } catch (err) {
      setOutcomeError(toKoreanErrorMessage(err, "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요."));
    } finally {
      setSavingOutcome(false);
    }
  }

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={s.modalBackdrop} onPress={onClose}>
        <Pressable style={s.modalSheet} onPress={(event) => event.stopPropagation()}>
          <SafeAreaView edges={["bottom"]}>
            <ScrollView
              contentContainerStyle={s.sheetScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={s.sheetHeader}>
                <View style={s.sheetTitleBlock}>
                  <AppText variant="eyebrow">REQUEST RECORD DETAIL</AppText>
                  <AppText variant="subtitle">{booking.vendor?.name ?? "업체 미정"}</AppText>
                </View>
                <Pressable
                  style={s.closeButton}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="닫기"
                >
                  <X size={20} color={colors.noir[800]} />
                </Pressable>
              </View>

              <View style={s.sheetStatusRow}>
                <StatusPill label={status.label} tone={status.tone} />
                <StatusPill label={action.label} tone={action.tone} />
              </View>

              <View style={s.detailRows}>
                <DetailRow
                  icon={<Store size={18} color={colors.noir[800]} />}
                  label="카테고리"
                  value={categoryLabel(booking.vendor?.category)}
                />
                <DetailRow
                  icon={<FileCheck2 size={18} color={colors.noir[800]} />}
                  label="상품"
                  value={booking.product?.name ?? "상품 미정"}
                />
                <DetailRow
                  icon={<CalendarDays size={18} color={colors.noir[800]} />}
                  label="날짜"
                  value={formatDateLong(booking.booking_date)}
                />
                <DetailRow
                  icon={<Clock size={18} color={colors.noir[800]} />}
                  label="시간"
                  value={booking.booking_time ?? "시간 확인 필요"}
                />
                <DetailRow
                  icon={<WalletCards size={18} color={colors.noir[800]} />}
                  label="금액 기록"
                  value={bookingAmountLabel(booking)}
                />
              </View>

              <View style={s.noticeBox}>
                <AlertTriangle size={18} color="#8A6A28" />
                <View style={s.noticeCopy}>
                  <AppText variant="bodyStrong">{action.title}</AppText>
                  <AppText variant="caption">{action.description}</AppText>
                </View>
              </View>

              {completed ? (
                <View style={s.outcomeBox}>
                  <View style={s.outcomeHeader}>
                    <View style={s.outcomeTitleBlock}>
                      <AppText variant="eyebrow">SPEND MEMORY</AppText>
                      <AppText variant="bodyStrong">사용자 입력 지출·후기 기록</AppText>
                    </View>
                    {booking.actual_amount ? (
                      <StatusPill label="기록 있음" tone="success" />
                    ) : null}
                  </View>

                  <View style={s.inputGroup}>
                    <AppText variant="caption">계약/견적 참고 금액(직접 입력)</AppText>
                    <TextInput
                      value={contractedAmountText}
                      onChangeText={setContractedAmountText}
                      keyboardType="number-pad"
                      placeholder="예: 2500000"
                      placeholderTextColor={colors.paper.inkFaint}
                      style={s.textInput}
                    />
                  </View>

                  <View style={s.inputGroup}>
                    <AppText variant="caption">기록 지출(사용자 입력 · 결제 증빙 아님)</AppText>
                    <TextInput
                      value={actualAmountText}
                      onChangeText={setActualAmountText}
                      keyboardType="number-pad"
                      placeholder="사용자가 확인한 지출 총액"
                      placeholderTextColor={colors.paper.inkFaint}
                      style={s.textInput}
                    />
                  </View>

                  <View style={s.inputGroup}>
                    <AppText variant="caption">만족도</AppText>
                    <View style={s.ratingRow}>
                      {[1, 2, 3, 4, 5].map((value) => {
                        const selected = rating === value;
                        return (
                          <Pressable
                            key={value}
                            style={[s.ratingButton, selected && s.ratingButtonActive]}
                            onPress={() => setRating(value)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                          >
                            <Star
                              size={16}
                              color={selected ? "#FFFFFF" : colors.textTertiary}
                              fill={selected ? "#FFFFFF" : "transparent"}
                            />
                            <AppText
                              variant="caption"
                              style={selected ? s.ratingTextActive : s.ratingText}
                            >
                              {value}
                            </AppText>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={s.inputGroup}>
                    <AppText variant="caption">사용자 입력 후기(이용·결제 확인 증빙 아님)</AppText>
                    <TextInput
                      value={reviewText}
                      onChangeText={(value) => setReviewText(value.slice(0, 1000))}
                      placeholder="추가금, 상담 품질, 아쉬운 점을 남겨주세요"
                      placeholderTextColor={colors.paper.inkFaint}
                      multiline
                      textAlignVertical="top"
                      style={[s.textInput, s.reviewInput]}
                    />
                    <AppText variant="caption" style={s.charCount}>
                      {reviewText.length}/1000
                    </AppText>
                  </View>

                  <View style={s.publicToggleRow}>
                    <View style={s.publicToggleCopy}>
                      <AppText variant="bodyStrong">사용자 입력 후기로 공개</AppText>
                      <AppText variant="caption">
                        아모라가 이용·결제를 검증한 후기가 아니에요. 끄면 아모라 예약 요청 기록에만 저장되고 공개 목록에는 보이지 않아요.
                      </AppText>
                    </View>
                    <Switch
                      value={sharePublicReview}
                      onValueChange={setSharePublicReview}
                      trackColor={{ false: colors.ivory[200], true: colors.rose.glow }}
                      thumbColor={sharePublicReview ? colors.rose[500] : "#FFFFFF"}
                    />
                  </View>

                  {actualAmount !== null && contractedAmount !== null ? (
                    <View style={s.outcomePreview}>
                      <AppText variant="caption">
                        입력 기준 추가 지출 {formatWon(Math.max(0, actualAmount - contractedAmount))}
                      </AppText>
                    </View>
                  ) : null}

                  {outcomeError ? (
                    <AppText variant="caption" style={s.errorText}>
                      {outcomeError}
                    </AppText>
                  ) : null}
                  {outcomeMessage ? (
                    <AppText variant="caption" style={s.successText}>
                      {outcomeMessage}
                    </AppText>
                  ) : null}

                  <PrimaryButton
                    tone="noir"
                    onPress={saveOutcome}
                    disabled={!canSaveOutcome}
                  >
                    {savingOutcome ? "저장 중..." : "사용자 입력 지출·결과 저장"}
                  </PrimaryButton>
                </View>
              ) : null}

              <PrimaryButton tone={completed ? "ghost" : "noir"} onPress={onClose}>
                확인했어요
              </PrimaryButton>
            </ScrollView>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={s.detailRow}>
      <View style={s.detailIcon}>{icon}</View>
      <View style={s.detailCopy}>
        <AppText variant="caption">{label}</AppText>
        <AppText variant="bodyStrong">{value}</AppText>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  tab: {
    minHeight: 34,
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 16,
    backgroundColor: colors.ivory[200],
  },
  tabActive: {
    backgroundColor: colors.noir[800],
  },
  tabText: {
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  summaryCard: {
    gap: 16,
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryTitleBlock: {
    flex: 1,
    gap: 3,
  },
  summaryEyebrow: {
    color: summaryColors.label,
  },
  summaryTitle: {
    color: summaryColors.ink,
  },
  summaryBody: {
    color: summaryColors.ink,
  },
  summaryMetaRow: {
    gap: 8,
  },
  summaryMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summaryMetaText: {
    color: summaryColors.label,
  },
  reviewTitle: {
    marginTop: 4,
    marginBottom: 2,
  },
  summaryStats: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: summaryColors.line,
    // 요약 면 안의 한 칸. 흰 바탕이라 글자 대비는 면보다 높다.
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statNumber: {
    color: summaryColors.ink,
  },
  statLabel: {
    color: summaryColors.label,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: summaryColors.line,
  },
  list: {
    gap: 12,
  },
  cardPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  card: {
    gap: 12,
    padding: 18,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitleBlock: {
    flex: 1,
    gap: 2,
  },
  infoGrid: {
    gap: 8,
  },
  infoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  actionRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  actionCopy: {
    flex: 1,
    gap: 2,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(13,13,15,0.42)",
  },
  modalSheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
    padding: 20,
    gap: 18,
  },
  sheetScroll: {
    paddingBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 14,
  },
  sheetTitleBlock: {
    flex: 1,
    gap: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: colors.ivory[100],
  },
  sheetStatusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  detailRows: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 16,
  },
  detailRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  detailIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.ivory[100],
  },
  detailCopy: {
    flex: 1,
    gap: 2,
  },
  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 16,
    backgroundColor: "rgba(201,169,110,0.14)",
    padding: 14,
    marginBottom: 16,
  },
  noticeCopy: {
    flex: 1,
    gap: 2,
  },
  outcomeBox: {
    gap: 14,
    borderRadius: 20,
    backgroundColor: colors.ivory[100],
    padding: 16,
    marginBottom: 16,
  },
  outcomeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  outcomeTitleBlock: {
    flex: 1,
    gap: 2,
  },
  inputGroup: {
    gap: 6,
  },
  textInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
  },
  reviewInput: {
    minHeight: 96,
    lineHeight: 22,
  },
  charCount: {
    alignSelf: "flex-end",
  },
  ratingRow: {
    flexDirection: "row",
    gap: 8,
  },
  ratingButton: {
    minWidth: 46,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ratingButtonActive: {
    borderColor: colors.noir[800],
    backgroundColor: colors.noir[800],
  },
  ratingText: {
    color: colors.textSecondary,
  },
  ratingTextActive: {
    color: "#FFFFFF",
  },
  publicToggleRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  publicToggleCopy: {
    flex: 1,
    gap: 2,
  },
  outcomePreview: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "rgba(201,169,110,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  errorText: {
    color: colors.dangerDeep,
  },
  successText: {
    color: colors.noir.soft,
  },
});
