import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  cleanOptionalIsoDate,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 32 * 1024;
const EVENT_ID_RE = /^[a-zA-Z0-9:_-]{1,120}$/;
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

type CleanScheduleEvent = Record<string, unknown> & { id: string };
type AuthoritativeScheduleProgress = Record<string, unknown> & {
  __events: CleanScheduleEvent[];
};

function cleanTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_TIMESTAMP_RE.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function cleanEvent(value: unknown): CleanScheduleEvent | null {
  if (!isRecord(value) || typeof value.id !== "string" || !EVENT_ID_RE.test(value.id)) {
    return null;
  }
  for (const optionalKey of ["time", "memo", "categoryKey", "sourceKey", "momentType"] as const) {
    if (value[optionalKey] !== undefined && typeof value[optionalKey] !== "string") {
      return null;
    }
  }

  const date = cleanOptionalIsoDate(value.date);
  const title = cleanOptionalText(value.title, 160);
  const createdAt = cleanTimestamp(value.createdAt);
  const updatedAt = cleanTimestamp(value.updatedAt);
  if (!date || !title || !createdAt || !updatedAt) return null;

  const event: CleanScheduleEvent = {
    id: value.id,
    date,
    title,
    createdAt,
    updatedAt,
  };
  const time = cleanOptionalText(value.time, 5);
  const memo = cleanOptionalText(value.memo, 1000);
  const categoryKey = cleanOptionalText(value.categoryKey, 80);
  const sourceKey = cleanOptionalText(value.sourceKey, 120);
  const momentType = cleanOptionalText(value.momentType, 80);
  if (value.time !== undefined && (!time || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    return null;
  }
  if (time) event.time = time;
  if (memo) event.memo = memo;
  if (categoryKey) event.categoryKey = categoryKey;
  if (sourceKey) event.sourceKey = sourceKey;
  if (momentType) event.momentType = momentType;
  return event;
}

function isAuthoritativeProgress(value: unknown): value is AuthoritativeScheduleProgress {
  if (!isRecord(value) || !Array.isArray(value.__events)) return false;
  const events = value.__events.map(cleanEvent);
  if (events.some((event) => event === null)) return false;
  const ids = events.map((event) => event?.id);
  return ids.length === events.length && new Set(ids).size === ids.length;
}

export async function POST(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    if (
      !isRecord(body) ||
      (body.operation !== "add" && body.operation !== "update" && body.operation !== "delete")
    ) {
      return NextResponse.json({ error: "지원하지 않는 일정 변경입니다." }, { status: 400 });
    }

    const event = body.operation === "delete" ? null : cleanEvent(body.event);
    if (body.operation !== "delete" && !event) {
      return NextResponse.json({ error: "일정 입력값을 확인해 주세요." }, { status: 400 });
    }
    const eventId = body.operation === "add" ? event?.id : body.eventId;
    const expectedUpdatedAt = body.operation !== "add"
      ? cleanTimestamp(body.expectedUpdatedAt)
      : null;
    if (
      typeof eventId !== "string" ||
      !EVENT_ID_RE.test(eventId) ||
      (event !== null && event.id !== eventId) ||
      (body.operation !== "add" && !expectedUpdatedAt)
    ) {
      return NextResponse.json({ error: "변경할 일정을 확인할 수 없습니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();
    if (profileError || !profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보를 확인할 수 없습니다." }, { status: 404 });
    }

    const { data, error } = await admin.rpc("mutate_journey_schedule_event", {
      p_couple_id: profile.couple_id,
      p_operation: body.operation,
      p_event: event,
      p_event_id: eventId,
      p_expected_updated_at: expectedUpdatedAt,
    });
    if (error) {
      if (error.code === "40001" || error.message?.includes("schedule_event_conflict")) {
        const { data: latestJourney, error: latestError } = await admin
          .from("wedding_journeys")
          .select("progress")
          .eq("couple_id", profile.couple_id)
          .single();
        if (latestError || !isAuthoritativeProgress(latestJourney?.progress)) {
          console.error("schedule conflict latest-state read failed:", latestError);
          return NextResponse.json(
            { error: "최신 일정 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
            { status: 503 },
          );
        }
        return NextResponse.json(
          {
            error: "다른 기기에서 이 일정이 먼저 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.",
            progress: latestJourney.progress,
          },
          { status: 409 },
        );
      }
      console.error("atomic schedule event mutation failed:", error);
      return NextResponse.json({ error: "일정을 저장하지 못했습니다." }, { status: 500 });
    }

    if (!isRecord(data) || !isAuthoritativeProgress(data.progress)) {
      console.error("atomic schedule event mutation returned malformed data");
      return NextResponse.json({ error: "저장 결과를 확인하지 못했습니다." }, { status: 500 });
    }

    const returnedEvent = data.event === null ? null : cleanEvent(data.event);
    const progressContainsEvent = data.progress.__events.some(
      (progressEvent) => progressEvent.id === eventId,
    );
    const responseMatchesMutation = body.operation === "delete"
      ? data.event === null && !progressContainsEvent
      : returnedEvent !== null && returnedEvent.id === eventId && progressContainsEvent;
    if (data.eventId !== eventId || !responseMatchesMutation) {
      console.error("atomic schedule event mutation returned mismatched data");
      return NextResponse.json({ error: "저장 결과를 확인하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({
      progress: data.progress,
      event: data.event,
      eventId: data.eventId,
    });
  } catch (error) {
    console.error("Schedule event API error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
