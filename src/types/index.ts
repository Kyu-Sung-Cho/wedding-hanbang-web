export type UserRole = 'bride' | 'groom';

export type CategoryStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export type CategoryId =
  | 'first_greeting' | 'formal_meeting' | 'wedding_hall'
  | 'studio' | 'dress' | 'makeup' | 'snap_dvd'
  | 'suit' | 'hanbok' | 'wedding_nail' | 'parent_makeup'
  | 'wedding_ring' | 'gifts' | 'invitation' | 'officiant'
  | 'appliances' | 'furniture' | 'honeymoon_house'
  | 'honeymoon_trip' | 'return_gifts' | 'wedding_ceremony';

export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  aiTip: string;
  isRequired: boolean;
  order: number;
}

export interface Category {
  id: CategoryId;
  name: string;
  emoji: string;
  description: string;
  order: number;
  suggestedTiming: {
    earliestDaysBefore: number;
    latestDaysBefore: number;
  };
  checklistItems: ChecklistItem[];
  commonMistakes: string[];
  tips: string[];
  estimatedCost: string;
}

export type ScheduleType = 'appointment' | 'deadline' | 'reminder' | 'meeting' | 'event';
export type ReminderTiming = 'at_time' | '10min_before' | '30min_before' | '1hour_before' | '1day_before' | '3days_before' | '1week_before';

export interface ReminderSetting {
  enabled: boolean;
  timings: ReminderTiming[];
}

export interface Schedule {
  id: string;
  title: string;
  description: string | null;
  categoryId: CategoryId;
  type: ScheduleType;
  date: string;
  time: string | null;
  location: string | null;
  isAllDay: boolean;
  reminder: ReminderSetting;
  isCompleted: boolean;
  createdAt: string;
  createdBy: 'user' | 'ai';
}

export interface CreateScheduleInput {
  title: string;
  description?: string | null;
  categoryId: CategoryId;
  type: ScheduleType;
  date: string;
  time?: string | null;
  location?: string | null;
  isAllDay: boolean;
  reminder: ReminderSetting;
  createdBy?: 'user' | 'ai';
}

export type UpdateScheduleInput = Partial<Omit<Schedule, 'id' | 'createdAt'>>;

export const SCHEDULE_TYPE_CONFIG: Record<ScheduleType, {
  label: string;
  color: string;
  icon: string;
  defaultReminder: ReminderTiming[];
}> = {
  appointment: { label: '예약', color: '#3B82F6', icon: 'Calendar', defaultReminder: ['1day_before', '1hour_before'] },
  deadline: { label: '마감', color: '#EF4444', icon: 'Clock', defaultReminder: ['3days_before', '1day_before'] },
  reminder: { label: '리마인더', color: '#F59E0B', icon: 'Bell', defaultReminder: ['at_time'] },
  meeting: { label: '미팅', color: '#10B981', icon: 'Users', defaultReminder: ['1day_before', '30min_before'] },
  event: { label: '이벤트', color: '#8B5CF6', icon: 'Heart', defaultReminder: ['1week_before', '1day_before'] },
};
