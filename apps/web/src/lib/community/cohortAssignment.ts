import {
  isRecord,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";

export const COHORT_ASSIGNMENT_MAX_BODY_BYTES = 1024;

export type CohortAssignmentBodyResult =
  | { ok: true; year: number; month: number }
  | { ok: false; status: 400 | 413 };

export async function readCohortAssignmentBody(
  request: Request,
): Promise<CohortAssignmentBodyResult> {
  const body = await readBoundedUtf8Text(
    request,
    COHORT_ASSIGNMENT_MAX_BODY_BYTES,
  );
  if (!body.ok) {
    return { ok: false, status: body.reason === "too_large" ? 413 : 400 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return { ok: false, status: 400 };
  }
  if (!isRecord(parsed)) return { ok: false, status: 400 };
  if (Object.keys(parsed).some((key) => key !== "year" && key !== "month")) {
    return { ok: false, status: 400 };
  }

  const year = parsed.year;
  const month = parsed.month;
  if (
    typeof year !== "number"
    || !Number.isInteger(year)
    || year < 2020
    || year > 2100
    || typeof month !== "number"
    || !Number.isInteger(month)
    || month < 1
    || month > 12
  ) {
    return { ok: false, status: 400 };
  }

  return { ok: true, year, month };
}
