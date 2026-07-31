import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";

const DEFAULT_WINDOW_DAYS = 30;
const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function parseWindowDays(request: NextRequest): number | null {
  const values = request.nextUrl.searchParams.getAll("windowDays");
  if (values.length === 0) return DEFAULT_WINDOW_DAYS;
  if (values.length !== 1 || !/^[0-9]+$/.test(values[0] ?? "")) return null;

  const value = Number(values[0]);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_WINDOW_DAYS ||
    value > MAX_WINDOW_DAYS
  ) {
    return null;
  }

  return value;
}

function isSchemaUnavailable(
  error: { code?: string; message?: string } | null,
) {
  if (!error) return false;
  return (
    ["42P01", "42703", "42883", "PGRST202"].includes(error.code ?? "") ||
    error.message?.includes("community_operational_health") === true
  );
}

export async function GET(request: NextRequest) {
  try {
    const { authorized } = await verifyAdmin(request);
    if (!authorized) {
      return json({ error: "Unauthorized" }, 401);
    }

    const windowDays = parseWindowDays(request);
    if (windowDays === null) {
      return json(
        {
          error: "windowDays must be one integer between 7 and 90.",
          code: "COMMUNITY_OPERATIONAL_HEALTH_INVALID_WINDOW",
        },
        400,
      );
    }

    const { data, error } = await getServiceClient().rpc(
      "community_operational_health" as never,
      { p_window_days: windowDays } as never,
    );

    if (error) {
      console.error("[admin community health] RPC failed:", {
        code: error.code,
        message: error.message,
      });

      if (isSchemaUnavailable(error)) {
        return json(
          {
            error:
              "Community operational health is unavailable until its database boundary is installed.",
            code: "COMMUNITY_OPERATIONAL_HEALTH_SCHEMA_UNAVAILABLE",
          },
          503,
        );
      }

      return json(
        {
          error: "Community operational health could not be measured.",
          code: "COMMUNITY_OPERATIONAL_HEALTH_FAILED",
        },
        500,
      );
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return json(
        {
          error: "Community operational health returned an invalid result.",
          code: "COMMUNITY_OPERATIONAL_HEALTH_INVALID_RESULT",
        },
        500,
      );
    }

    return json({ health: data });
  } catch (error) {
    console.error("[admin community health] unexpected:", error);
    return json(
      {
        error: "Community operational health could not be measured.",
        code: "COMMUNITY_OPERATIONAL_HEALTH_FAILED",
      },
      500,
    );
  }
}
