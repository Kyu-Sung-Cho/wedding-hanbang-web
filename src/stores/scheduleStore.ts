import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Schedule, CreateScheduleInput } from "@/types";
import * as scheduleService from "@/lib/services/scheduleService";

interface ScheduleState {
  schedules: Schedule[];
  coupleId: string | null;
  isSyncing: boolean;
}

interface ScheduleActions {
  addSchedule: (input: CreateScheduleInput) => Schedule;
  updateSchedule: (id: string, updates: Partial<Schedule>) => void;
  deleteSchedule: (id: string) => void;
  toggleScheduleComplete: (id: string) => void;
  toggleComplete: (id: string) => void;
  getSchedulesByDate: (date: string) => Schedule[];
  getUpcomingSchedules: (limit?: number) => Schedule[];
  getTodaySchedules: () => Schedule[];
  clearAll: () => void;
  setCoupleId: (id: string | null) => void;
  // Supabase 동기화
  loadFromServer: (coupleId: string) => Promise<void>;
}

export const useScheduleStore = create<ScheduleState & ScheduleActions>()(
  persist(
    (set, get) => ({
      schedules: [],
      coupleId: null,
      isSyncing: false,

      setCoupleId: (coupleId) => set({ coupleId }),

      addSchedule: (input) => {
        const schedule: Schedule = {
          ...input,
          id: crypto.randomUUID(),
          description: input.description || null,
          time: input.time || null,
          location: input.location || null,
          isCompleted: false,
          createdAt: new Date().toISOString(),
          createdBy: input.createdBy || "user",
        };
        set((state) => ({ schedules: [...state.schedules, schedule] }));

        // Supabase에 저장
        const { coupleId } = get();
        if (coupleId) {
          scheduleService.upsertSchedule(coupleId, {
            id: schedule.id,
            title: schedule.title,
            description: schedule.description,
            category: schedule.categoryId,
            type: schedule.type,
            date: schedule.date,
            time: schedule.time,
            location: schedule.location,
            is_completed: false,
            created_by: schedule.createdBy,
          });
        }
        return schedule;
      },

      updateSchedule: (id, updates) => {
        set((state) => ({
          schedules: state.schedules.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }));

        // Supabase에 반영
        const serverUpdates: Record<string, unknown> = {};
        if (updates.title !== undefined) serverUpdates.title = updates.title;
        if (updates.description !== undefined) serverUpdates.description = updates.description;
        if (updates.categoryId !== undefined) serverUpdates.category = updates.categoryId;
        if (updates.type !== undefined) serverUpdates.type = updates.type;
        if (updates.date !== undefined) serverUpdates.date = updates.date;
        if (updates.time !== undefined) serverUpdates.time = updates.time;
        if (updates.location !== undefined) serverUpdates.location = updates.location;
        if (updates.isCompleted !== undefined) serverUpdates.is_completed = updates.isCompleted;

        if (Object.keys(serverUpdates).length > 0) {
          scheduleService.updateSchedule(id, serverUpdates as Parameters<typeof scheduleService.updateSchedule>[1]);
        }
      },

      deleteSchedule: (id) => {
        set((state) => ({
          schedules: state.schedules.filter((s) => s.id !== id),
        }));
        scheduleService.deleteSchedule(id);
      },

      toggleScheduleComplete: (id) => {
        const schedule = get().schedules.find((s) => s.id === id);
        if (!schedule) return;
        const newCompleted = !schedule.isCompleted;

        set((state) => ({
          schedules: state.schedules.map((s) =>
            s.id === id ? { ...s, isCompleted: newCompleted } : s
          ),
        }));
        scheduleService.toggleScheduleComplete(id, newCompleted);
      },

      getSchedulesByDate: (date) => {
        return get().schedules.filter((s) => s.date === date);
      },

      getUpcomingSchedules: (limit = 5) => {
        const today = new Date().toISOString().split("T")[0];
        return get()
          .schedules.filter((s) => s.date >= today && !s.isCompleted)
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, limit);
      },

      getTodaySchedules: () => {
        const today = new Date().toISOString().split("T")[0];
        return get().schedules.filter((s) => s.date === today);
      },

      toggleComplete: (id: string) => {
        const schedule = get().schedules.find((s) => s.id === id);
        if (!schedule) return;
        const newCompleted = !schedule.isCompleted;

        set((state) => ({
          schedules: state.schedules.map((s) =>
            s.id === id ? { ...s, isCompleted: newCompleted } : s
          ),
        }));
        scheduleService.toggleScheduleComplete(id, newCompleted);
      },

      clearAll: () => set({ schedules: [] }),

      // Supabase에서 일정 로드
      loadFromServer: async (coupleId: string) => {
        try {
          set({ coupleId, isSyncing: true });
          const rows = await scheduleService.getSchedules(coupleId);

          const schedules: Schedule[] = rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            categoryId: row.category as Schedule["categoryId"],
            type: row.type as Schedule["type"],
            date: row.date,
            time: row.time,
            location: row.location,
            isAllDay: !row.time,
            reminder: { enabled: true, timings: ["1day_before"] },
            isCompleted: row.is_completed,
            createdAt: row.created_at,
            createdBy: (row.created_by || "user") as "user" | "ai",
          }));

          set({ schedules });
        } catch (error) {
          console.error("서버에서 일정 로드 실패:", error);
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    { name: "schedule-store" }
  )
);
