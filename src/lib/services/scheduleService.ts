import { createClient } from "@/lib/supabase/client";

export interface ScheduleRow {
  id: string;
  couple_id: string;
  title: string;
  description: string | null;
  category: string;
  type: string;
  date: string;
  time: string | null;
  location: string | null;
  is_completed: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// 일정 목록 조회
export async function getSchedules(coupleId: string): Promise<ScheduleRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("couple_id", coupleId)
    .order("date", { ascending: true });

  if (error) {
    console.error("일정 조회 실패:", error);
    return [];
  }
  return (data || []) as ScheduleRow[];
}

// 일정 추가 (upsert)
export async function upsertSchedule(
  coupleId: string,
  schedule: {
    id?: string;
    title: string;
    description?: string | null;
    category: string;
    type: string;
    date: string;
    time?: string | null;
    location?: string | null;
    is_completed?: boolean;
    created_by?: string;
  }
) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("schedules")
    .upsert(
      {
        ...schedule,
        couple_id: coupleId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    console.error("일정 저장 실패:", error);
    return null;
  }
  return data as ScheduleRow;
}

// 일정 업데이트
export async function updateSchedule(
  scheduleId: string,
  updates: Partial<Pick<ScheduleRow, "title" | "description" | "category" | "type" | "date" | "time" | "location" | "is_completed">>
) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("schedules")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", scheduleId)
    .select()
    .single();

  if (error) {
    console.error("일정 업데이트 실패:", error);
    return null;
  }
  return data as ScheduleRow;
}

// 일정 삭제
export async function deleteSchedule(scheduleId: string) {
  const supabase = createClient();

  const { error } = await supabase
    .from("schedules")
    .delete()
    .eq("id", scheduleId);

  if (error) {
    console.error("일정 삭제 실패:", error);
    return false;
  }
  return true;
}

// 일정 완료 토글
export async function toggleScheduleComplete(scheduleId: string, isCompleted: boolean) {
  return updateSchedule(scheduleId, { is_completed: isCompleted });
}

// 일정 실시간 구독
export function subscribeToSchedules(
  coupleId: string,
  callback: (schedules: ScheduleRow[]) => void
) {
  const supabase = createClient();

  const channel = supabase
    .channel(`schedules:${coupleId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "schedules",
        filter: `couple_id=eq.${coupleId}`,
      },
      async () => {
        // 변경 발생 시 전체 목록 다시 조회
        const schedules = await getSchedules(coupleId);
        callback(schedules);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
