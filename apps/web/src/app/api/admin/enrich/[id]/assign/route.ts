import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { z } from "zod";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export async function POST(
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
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
  }

  try {
    const { error } = await getServiceClient().rpc("assign_vendor_enrichment", {
      p_vendor_id: id.data,
      p_actor_id: userId,
    });
    if (error) {
      return NextResponse.json(
        { error: "담당 배정에 실패했습니다. 이미 완료된 업체인지 확인해 주세요." },
        { status: 409 },
      );
    }
    return NextResponse.json({ assigned: true });
  } catch {
    return NextResponse.json(
      { error: "담당 배정에 실패했습니다. 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
