import { isAmoraTasksEnabled } from "@/lib/amoraTasks/config";
import { resolveTaskViewer, taskJson, taskOffResponse, toTaskSummary } from "@/lib/amoraTasks/taskApi";
import { isAmoraTaskStorageUnavailable, listAmoraTasksForMember } from "@/lib/amoraTasks/taskStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 홈의 "아모라가 맡은 일"(웹·앱). 회원 클라이언트(RLS)로 자기 커플 줄만 읽는다.
 * 스위치가 꺼졌으면 `{ enabled:false }`, 표가 아직 없으면 `{ available:false }` 를 준다. 화면은 그때 그리지 않는다.
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveTaskViewer(request, "amora-tasks:list", 60);
    if (!auth.ok) return auth.response;
    if (!isAmoraTasksEnabled()) return taskOffResponse("disabled");
    const { supabase, coupleId } = auth.viewer;
    if (!coupleId) return taskJson({ enabled: true, available: true, tasks: [] });
    const rows = await listAmoraTasksForMember(supabase, coupleId);
    return taskJson({ enabled: true, available: true, tasks: rows.map(toTaskSummary) });
  } catch (error) {
    if (isAmoraTaskStorageUnavailable(error)) return taskOffResponse("unavailable");
    console.error("[amora-tasks] list failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return taskJson({ error: "맡은 일을 불러오지 못했어요.", code: "AMORA_TASKS_LIST_FAILED" }, 503);
  }
}
