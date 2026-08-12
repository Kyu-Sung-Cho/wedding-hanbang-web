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

export interface DashboardFocus {
  kind: DashboardFocusKind;
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  route:
    | "/onboarding"
    | "/checklist"
    | "/schedule"
    | "/bookings"
    | "/(tabs)/chat";
  bookingId?: string;
}

export type DashboardHomeServiceKey =
  | "checklist"
  | "schedule"
  | "budget"
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
    | "/market-prices"
    | "/quote-check"
    | "/bookings"
    | "/(tabs)/community";
}

export const HOME_SERVICES: readonly DashboardHomeService[];

export function formatLocalDateKey(date?: Date): string;

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
