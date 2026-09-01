import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { log } from "@/utils/log";
import { listPendingPriceUploadConfirmations } from "@/lib/admin/priceUploadConfirmations";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await verifyAdmin(request);
  if (!admin.authorized || !admin.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const confirmations = await listPendingPriceUploadConfirmations(getServiceClient());
    return NextResponse.json({ confirmations });
  } catch (err) {
    log.error("api/admin/price/upload/confirmations", err);
    return NextResponse.json(
      { error: "확인이 필요한 업로드를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
