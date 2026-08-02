import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import {
  PriceUploadConfirmationError,
  resolvePendingPriceUploadConfirmation,
} from "@/lib/admin/priceUploadConfirmations";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { z } from "zod";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;
const requestSchema = z.strictObject({
  vendor_id: z.string().uuid(),
  expected_version: z.literal(0),
});

async function readBoundedBody(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BODY_BYTES) return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel("confirmation request too large").catch(() => undefined);
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function errorResponse(error: unknown) {
  if (error instanceof PriceUploadConfirmationError) {
    if (error.kind === "not_found") {
      return NextResponse.json(
        { error: "확인 항목을 찾을 수 없습니다.", code: "PRICE_UPLOAD_CONFIRMATION_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (error.kind === "invalid") {
      return NextResponse.json(
        { error: "선택한 업체를 다시 확인해 주세요.", code: "PRICE_UPLOAD_CONFIRMATION_INVALID" },
        { status: 400 },
      );
    }
    if (error.kind === "conflict") {
      return NextResponse.json(
        {
          error: "다른 변경과 겹쳤습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.",
          code: "PRICE_UPLOAD_CONFIRMATION_CONFLICT",
        },
        { status: 409 },
      );
    }
  }
  return NextResponse.json(
    { error: "업체 연결을 저장하지 못했습니다.", code: "PRICE_UPLOAD_CONFIRMATION_FAILED" },
    { status: 500 },
  );
}

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
  const admin = await verifyAdmin(request);
  if (!admin.authorized || !admin.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const confirmationId = z.string().uuid().safeParse((await params).id);
  if (!confirmationId.success) {
    return NextResponse.json(
      { error: "확인 항목을 찾을 수 없습니다.", code: "PRICE_UPLOAD_CONFIRMATION_NOT_FOUND" },
      { status: 404 },
    );
  }
  const rawBody = await readBoundedBody(request);
  if (rawBody === null) {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const input = requestSchema.safeParse(raw);
  if (!input.success) {
    return NextResponse.json(
      { error: "선택한 업체와 목록 버전을 확인해 주세요." },
      { status: 400 },
    );
  }

  try {
    const result = await resolvePendingPriceUploadConfirmation(getServiceClient(), {
      confirmationId: confirmationId.data,
      selectedVendorId: input.data.vendor_id,
      expectedVersion: input.data.expected_version,
      resolvedBy: admin.userId,
    });
    return NextResponse.json({ resolved: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
