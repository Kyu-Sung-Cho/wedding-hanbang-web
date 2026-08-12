// 홈 — 우리의 결혼식, 오늘의 한 가지, 준비 서비스 (Supabase 실데이터)
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import {
  calculateChecklistProgress,
  formatLocalDateKey,
} from "@/lib/dashboardExperience.mjs";
import { isActiveScheduleEvent } from "@/lib/scheduleMutation.mjs";
import ErrorRetry from "@/components/ErrorRetry";
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

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [careRefreshVersion, setCareRefreshVersion] = useState(0);
  const [error, setError] = useState(false);
  const coupleIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
        .select("name, couple_id")
        .eq("id", user.id)
        .single();
      if (profileError) throw profileError;

      coupleIdRef.current = profile.couple_id ?? null;

      if (!profile.couple_id) {
        setData({
          name: profile.name ?? null,
          weddingDate: null,
          totalBudget: 0,
          progress: {},
          progressPercent: 0,
          todayTasks: [],
          dday: null,
          urgentTasks: [],
          bookingOutcomeTasks: [],
          partnerActivity: null,
        });
        return;
      }

      const { data: journey, error: journeyError } = await supabase
        .from("wedding_journeys")
        .select("wedding_date, total_budget, progress")
        .eq("couple_id", profile.couple_id)
        .single();
      if (journeyError) throw journeyError;

      const progress =
        (journey.progress as Record<string, unknown> | null) ?? {};
      const progressPercent = calculateChecklistProgress(
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
        progress,
        progressPercent,
        todayTasks,
        dday,
        urgentTasks: calcUrgentTasks(dday, progress),
        bookingOutcomeTasks: [],
        partnerActivity: null,
      };

      // 홈의 핵심 맥락과 오늘의 행동을 먼저 그린 뒤, 보조 데이터를 이어 붙인다.
      setData(coreData);
      setLoading(false);
      setRefreshing(false);

      const [bookingOutcomeTasks, partnerActivity] = await Promise.all([
        loadBookingOutcomeTasks(profile.couple_id),
        loadPartnerActivity({
          coupleId: profile.couple_id,
          userId: user.id,
          progress,
        }),
      ]);

      setData((current) =>
        current
          ? { ...current, bookingOutcomeTasks, partnerActivity }
          : current,
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
        todayOneCare={<TodayOneCareCard refreshVersion={careRefreshVersion} />}
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
