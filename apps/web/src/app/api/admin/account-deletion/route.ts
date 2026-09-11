import { NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { isDeletionJobId, readDeletionOperations, reportDeletionOperationsFailure } from "@/lib/accountDeletion/operations";

export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  try {
    if (!(await verifyAdmin(request)).authorized) return json({ error: "Unauthorized" }, 401);
    const params = new URL(request.url).searchParams;
    const ids = params.getAll("jobId");
    if ([...params.keys()].some((key) => key !== "jobId") || ids.length > 1
      || (ids.length === 1 && !isDeletionJobId(ids[0]))) {
      return json({ error: "Invalid job query" }, 400);
    }
    const result = await readDeletionOperations(getServiceClient(), ids[0] ?? null);
    if ("job" in result && result.job === null) return json({ error: "Deletion job not found" }, 404);
    return json(result);
  } catch {
    reportDeletionOperationsFailure("admin-read");
    return json({ error: "Account deletion status unavailable" }, 503);
  }
}
