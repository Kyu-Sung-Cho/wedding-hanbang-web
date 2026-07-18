// 내 예약 목록
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
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
import { supabase } from "@/lib/supabase";
import { apiJson } from "@/lib/api";
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
  { key: "upcoming", label: "예정" },
  { key: "completed", label: "완료" },
  { key: "cancelled", label: "취소" },
];

const STATUS_MAP: Record<BookingStatus, { label: string; tone: PillTone }> = {
  pending: { label: "대기중", tone: "warning" },
  confirmed: { label: "확정", tone: "success" },
  completed: { label: "완료", tone: "neutral" },
  cancelled: { label: "취소됨", tone: "danger" },
};

const CATEGORY_LABELS: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  venue: "예식장",
  snap: "스냅",
  hanbok: "한복",
  jewelry: "예물",
  ring: "예물",
  honeymoon: "허니문",
  package: "패키지",
  dvd: "영상",
  suit: "예복",
  invitation: "청첩장",
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
    return `실결제 ${formatWon(booking.actual_amount)}`;
  }
  if (booking.contracted_amount && booking.contracted_amount > 0) {
    return `계약 ${formatWon(booking.contracted_amount)}`;
  }
  if (booking.amount && booking.amount > 0) {
    return formatWon(booking.amount);
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
      label: "취소됨",
      title: "취소된 예약",
      description: "필요하면 업체와 재예약 가능 여부를 다시 확인하세요.",
      tone: "danger",
    };
  }

  if (isCompleted(booking)) {
    if (booking.actual_amount && booking.actual_amount > 0) {
      return {
        label: "기록됨",
        title: "실제 금액 기록 완료",
        description: "추가금 데이터가 다음 업체 추천과 예산 판단에 반영돼요.",
        tone: "success",
      };
    }

    return {
      label: "완료",
      title: "진행 완료",
      description: "실제 추가금과 만족도를 남기면 다음 추천 정확도가 좋아져요.",
      tone: "warning",
    };
  }

  if (booking.status === "pending") {
    return {
      label: "확인 필요",
      title: "업체 확정 대기",
      description: "확정 전 포함/불포함, 변경·환불 조건을 먼저 확인하세요.",
      tone: "warning",
    };
  }

  const daysUntil = getDaysUntil(booking);
  if (daysUntil <= 7) {
    return {
      label: "다가옴",
      title: "방문 준비",
      description: "방문 시간, 담당자, 준비물, 추가금 가능성을 다시 확인하세요.",
      tone: "warning",
    };
  }

  return {
    label: "확정",
    title: "예약 유지",
    description: "방문 전날 시간과 위치를 한 번 더 재확인하면 좋아요.",
    tone: "success",
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
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const openedBookingIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setBookings([]);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .single();

      if (!profile?.couple_id) {
        setCoupleId(null);
        setBookings([]);
        return;
      }

      setCoupleId(profile.couple_id);

      const { data, error } = await supabase
        .from("vendor_bookings")
        .select("id, booking_date, booking_time, status, amount, contracted_amount, actual_amount, vendor:vendors(name, category), product:vendor_products(name, price)")
        .eq("couple_id", profile.couple_id)
        .order("booking_date", { ascending: false });

      if (error) throw error;

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
      console.error("Bookings load:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
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
        loadData();
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

  function handleOutcomeSaved(updated: BookingOutcomeResponse["booking"]) {
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
          title="내 예약"
          subtitle="업체 예약 상태와 다음 행동"
          onBack={() => router.back()}
        />
        <LoadingState label="예약을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader
        title="내 예약"
        subtitle="업체 예약 상태와 다음 행동"
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
          <Surface tone="noir" style={s.summaryCard}>
            {summary.nextBooking && nextAction ? (
              <>
                <View style={s.summaryTop}>
                  <View style={s.summaryTitleBlock}>
                    <AppText variant="eyebrow" style={s.summaryEyebrow}>
                      BOOKING NEXT
                    </AppText>
                    <AppText variant="subtitle" style={s.summaryTitle} numberOfLines={2}>
                      {summary.nextBooking.vendor?.name ?? "업체 미정"}
                    </AppText>
                  </View>
                  <StatusPill label={nextAction.label} tone={nextAction.tone} />
                </View>
                <AppText variant="body" style={s.summaryBody}>
                  {nextAction.description}
                </AppText>
                <View style={s.summaryMetaRow}>
                  <View style={s.summaryMeta}>
                    <CalendarDays size={15} color="#FFFFFF" />
                    <AppText variant="caption" style={s.summaryMetaText}>
                      {formatDateLong(summary.nextBooking.booking_date)}
                      {summary.nextBooking.booking_time ? ` ${summary.nextBooking.booking_time}` : ""}
                    </AppText>
                  </View>
                  <View style={s.summaryMeta}>
                    <WalletCards size={15} color="#FFFFFF" />
                    <AppText variant="caption" style={s.summaryMetaText}>
                      {bookingAmountLabel(summary.nextBooking)}
                    </AppText>
                  </View>
                </View>
              </>
            ) : (
              <>
                <AppText variant="eyebrow" style={s.summaryEyebrow}>
                  BOOKING REVIEW
                </AppText>
                <AppText variant="subtitle" style={[s.reviewTitle, s.summaryTitle]}>
                  예정된 예약은 없어요
                </AppText>
                <AppText variant="body" style={s.summaryBody}>
                  완료된 예약의 실제 추가금과 만족도를 정리하면 다음 업체 추천이 더 정확해져요.
                </AppText>
              </>
            )}
            <View style={s.summaryStats}>
              <View style={s.statItem}>
                <AppText variant="bodyStrong" style={s.statNumber}>
                  {summary.upcomingCount}
                </AppText>
                <AppText variant="caption" style={s.statLabel}>예정</AppText>
              </View>
              <View style={s.statDivider} />
              <View style={s.statItem}>
                <AppText variant="bodyStrong" style={s.statNumber}>
                  {summary.pendingCount}
                </AppText>
                <AppText variant="caption" style={s.statLabel}>대기</AppText>
              </View>
              <View style={s.statDivider} />
              <View style={s.statItem}>
                <AppText variant="bodyStrong" style={s.statNumber}>
                  {summary.cancelledCount}
                </AppText>
                <AppText variant="caption" style={s.statLabel}>취소</AppText>
              </View>
            </View>
          </Surface>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState
            icon={
              <IconBadge tone="ivory" size={52}>
                <CalendarCheck size={26} color={colors.taupe[500]} />
              </IconBadge>
            }
            title={bookings.length === 0 ? "예약 내역이 없어요" : "이 조건의 예약이 없어요"}
            description={
              bookings.length === 0
                ? "업체 상세에서 상담 날짜와 상품을 선택하면 예약이 여기에 모여요."
                : "다른 상태 탭을 눌러 예약 흐름을 확인해보세요."
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
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        onSaved={handleOutcomeSaved}
      />
    </SafeAreaView>
  );
}

function BookingDetailSheet({
  booking,
  onClose,
  onSaved,
}: {
  booking: Booking | null;
  onClose: () => void;
  onSaved: (booking: BookingOutcomeResponse["booking"]) => void;
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

  if (!booking) return null;

  const action = getBookingAction(booking);
  const status = STATUS_MAP[booking.status];
  const completed = isCompleted(booking);
  const actualAmount = parseAmountInput(actualAmountText);
  const contractedAmount = parseAmountInput(contractedAmountText);
  const canSaveOutcome = completed && actualAmount !== null && rating !== null && !savingOutcome;

  async function saveOutcome() {
    if (!booking) return;
    if (actualAmount === null) {
      setOutcomeError("실제 결제금액을 입력해주세요.");
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
      const result = await apiJson<BookingOutcomeResponse>(
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
      onSaved(result.booking);
      setOutcomeMessage(
        result.outcome.extraAmount > 0
          ? `추가금 ${formatWon(result.outcome.extraAmount)}까지 기록했어요.`
          : "실제 결제금액을 기록했어요."
      );
    } catch (err) {
      setOutcomeError(err instanceof Error ? err.message : "저장에 실패했습니다.");
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
                  <AppText variant="eyebrow">BOOKING DETAIL</AppText>
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
                  label="금액"
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
                      <AppText variant="eyebrow">REAL COST MEMORY</AppText>
                      <AppText variant="bodyStrong">실제 금액과 만족도 기록</AppText>
                    </View>
                    {booking.actual_amount ? (
                      <StatusPill label="기록 있음" tone="success" />
                    ) : null}
                  </View>

                  <View style={s.inputGroup}>
                    <AppText variant="caption">계약/견적 금액</AppText>
                    <TextInput
                      value={contractedAmountText}
                      onChangeText={setContractedAmountText}
                      keyboardType="number-pad"
                      placeholder="예: 2500000"
                      placeholderTextColor={colors.textTertiary}
                      style={s.textInput}
                    />
                  </View>

                  <View style={s.inputGroup}>
                    <AppText variant="caption">실제 결제금액</AppText>
                    <TextInput
                      value={actualAmountText}
                      onChangeText={setActualAmountText}
                      keyboardType="number-pad"
                      placeholder="실제로 낸 총액을 입력해주세요"
                      placeholderTextColor={colors.textTertiary}
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
                    <AppText variant="caption">후기 메모</AppText>
                    <TextInput
                      value={reviewText}
                      onChangeText={(value) => setReviewText(value.slice(0, 1000))}
                      placeholder="추가금, 상담 품질, 아쉬운 점을 남겨주세요"
                      placeholderTextColor={colors.textTertiary}
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
                      <AppText variant="bodyStrong">공개 후기로 공유</AppText>
                      <AppText variant="caption">
                        끄면 추천 개선용으로만 저장되고 공개 목록에는 보이지 않아요.
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
                        추가금 {formatWon(Math.max(0, actualAmount - contractedAmount))}
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
                    {savingOutcome ? "저장 중..." : "실제 결과 저장"}
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
    color: "rgba(255,255,255,0.62)",
  },
  summaryTitle: {
    color: "#FFFFFF",
  },
  summaryBody: {
    color: "rgba(255,255,255,0.82)",
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
    color: "rgba(255,255,255,0.78)",
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
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statNumber: {
    color: "#FFFFFF",
  },
  statLabel: {
    color: "rgba(255,255,255,0.66)",
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255,255,255,0.16)",
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
    color: colors.danger,
  },
  successText: {
    color: colors.success,
  },
});
