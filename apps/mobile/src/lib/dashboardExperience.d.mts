export type DashboardUrgency = "overdue" | "soon" | "ontrack";

export interface DashboardUrgentTask {
  categoryKey: string;
  categoryLabel: string;
  remainingDays: number;
  urgency: DashboardUrgency;
}

export interface DashboardTodayTask {
  title: string;
  categoryKey: string;
}

export interface DashboardBookingOutcomeTask {
  id: string;
  vendorName: string;
  categoryLabel: string;
  bookingDate: string;
  isPast: boolean;
}

export type DashboardFocusKind =
  | "setup"
  | "urgent"
  | "today"
  | "booking"
  | "next"
  | "calm";

/** 카드 아래 「아모라에게 묻기」가 묻는 할 일. `@/lib/loungeAmoraAsk` 의 `LoungeAmoraTask` 와 같은 모양. */
export type DashboardFocusAmoraTask =
  | { kind: "checklist"; categoryLabel: string }
  | { kind: "event"; title: string };

export interface DashboardFocus {
  kind: DashboardFocusKind;
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  route:
    | "/settings"
    | "/checklist"
    | "/schedule"
    | "/bookings"
    | "/(tabs)/chat";
  bookingId?: string;
  /** 체크리스트 분야나 오늘 일정이 카드일 때만 있다. 날짜 설정·기록·여유 카드에는 없다. */
  amoraTask?: DashboardFocusAmoraTask;
}

export type DashboardHomeServiceKey =
  | "checklist"
  | "schedule"
  | "budget"
  | "etiquette"
  | "prices"
  | "quote"
  | "bookings"
  | "community";

export interface DashboardHomeService {
  key: DashboardHomeServiceKey;
  title: string;
  description: string;
  route:
    | "/checklist"
    | "/schedule"
    | "/budget"
    | "/etiquette"
    | "/market-prices"
    | "/quote-check"
    | "/bookings"
    | "/community";
}

export const HOME_SERVICES: readonly DashboardHomeService[];

export function buildHomeServices(input?: {
  hasBookingRecords?: boolean;
}): DashboardHomeService[];

export function formatLocalDateKey(date?: Date): string;

export function calculateChecklistCounts(
  progress: Record<string, unknown>,
  categories: readonly {
    key: string;
    items: readonly { id: string }[];
  }[],
): { done: number; total: number };

export function calculateChecklistProgress(
  progress: Record<string, unknown>,
  categories: readonly {
    key: string;
    items: readonly { id: string }[];
  }[],
): number;

export function buildDashboardFocus(input: {
  weddingDate: string | null;
  todayTasks: DashboardTodayTask[];
  urgentTasks: DashboardUrgentTask[];
  bookingOutcomeTasks: DashboardBookingOutcomeTask[];
}): DashboardFocus;

export function getWeddingMomentMessage(dday: number | null): string;
