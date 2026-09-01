import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { log } from "@/utils/log";
import { z } from "zod";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const vendorDecisionSchema = z.strictObject({
  decision: z.enum(["same", "different"]),
  preserved_vendor_id: z.string().uuid().nullable().optional().default(null),
}).superRefine((value, context) => {
  if (value.decision === "same" && value.preserved_vendor_id === null) {
    context.addIssue({
      code: "custom",
      path: ["preserved_vendor_id"],
      message: "병합 후 유지할 업체를 선택해 주세요.",
    });
  }
  if (value.decision === "different" && value.preserved_vendor_id !== null) {
    context.addIssue({
      code: "custom",
      path: ["preserved_vendor_id"],
      message: "다른 업체 결정에는 유지 업체가 필요하지 않습니다.",
    });
  }
});

const agencyDecisionSchema = z.strictObject({
  decision: z.enum(["same", "different"]),
  preserved_agency_id: z.string().uuid().nullable().optional().default(null),
}).superRefine((value, context) => {
  if (value.decision === "same" && value.preserved_agency_id === null) {
    context.addIssue({
      code: "custom",
      path: ["preserved_agency_id"],
      message: "병합 후 유지할 대행사를 선택해 주세요.",
    });
  }
  if (value.decision === "different" && value.preserved_agency_id !== null) {
    context.addIssue({
      code: "custom",
      path: ["preserved_agency_id"],
      message: "다른 대행사 결정에는 유지할 대행사가 필요하지 않습니다.",
    });
  }
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "vendor" && kind !== "agency") {
    return NextResponse.json(
      { error: "중복 판단 대상(kind=vendor 또는 kind=agency)을 지정해 주세요." },
      { status: 400 },
    );
  }

  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "중복 후보를 찾을 수 없습니다." }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  let decision: "same" | "different";
  let preservedId: string | null;
  if (kind === "vendor") {
    const body = vendorDecisionSchema.safeParse(rawBody);
    if (!body.success) {
      return NextResponse.json(
        { error: "중복 판단 값을 확인해 주세요.", issues: body.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    decision = body.data.decision;
    preservedId = body.data.preserved_vendor_id;
  } else {
    const body = agencyDecisionSchema.safeParse(rawBody);
    if (!body.success) {
      return NextResponse.json(
        { error: "중복 판단 값을 확인해 주세요.", issues: body.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    decision = body.data.decision;
    preservedId = body.data.preserved_agency_id;
  }

  try {
    const { error } = kind === "vendor"
      ? await getServiceClient().rpc("decide_vendor_dedupe_candidate", {
          p_candidate_id: id.data,
          p_decision: decision,
          p_preserved_vendor_id: preservedId,
          p_decided_by: userId,
        })
      : await getServiceClient().rpc("decide_agency_dedupe_candidate", {
          p_candidate_id: id.data,
          p_decision: decision,
          p_preserved_agency_id: preservedId,
          p_decided_by: userId,
        });
    if (error) {
      return NextResponse.json(
        { error: "중복 결정을 저장하지 못했습니다. 후보 쌍을 다시 확인해 주세요." },
        { status: 409 },
      );
    }
    return NextResponse.json({ decided: true, kind, decision });
  } catch (err) {
    log.error("api/admin/price/dedupe/[id]", err);
    return NextResponse.json(
      { error: "중복 결정을 저장하지 못했습니다. 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
