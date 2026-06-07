import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { runCommunityAgentAutomation } from "@/lib/community/agents/automation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AutomationRequestBody = {
  dryRun?: boolean;
  autoPublish?: boolean;
  maxActions?: number;
  seedIfEmpty?: boolean;
};

async function authorize(req: NextRequest): Promise<
  | { ok: true; source: "cron" | "admin"; userId?: string | null }
  | { ok: false }
> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET ?? process.env.COMMUNITY_AGENT_CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, source: "cron", userId: null };
  }

  const admin = await verifyAdmin(req);
  if (admin.authorized) {
    return { ok: true, source: "admin", userId: admin.userId ?? null };
  }

  return { ok: false };
}

async function run(req: NextRequest, body: AutomationRequestBody = {}) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runCommunityAgentAutomation(getServiceClient(), {
    triggerSource: auth.source,
    actorUserId: auth.userId ?? null,
    dryRun: body.dryRun ?? false,
    autoPublish: body.autoPublish ?? true,
    maxActions: body.maxActions,
    seedIfEmpty: body.seedIfEmpty ?? true,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return run(req, {
    dryRun: req.nextUrl.searchParams.get("dryRun") === "true",
    autoPublish: req.nextUrl.searchParams.get("autoPublish") !== "false",
    maxActions: Number(req.nextUrl.searchParams.get("maxActions") ?? "") || undefined,
    seedIfEmpty: req.nextUrl.searchParams.get("seedIfEmpty") !== "false",
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AutomationRequestBody;
  return run(req, body);
}
