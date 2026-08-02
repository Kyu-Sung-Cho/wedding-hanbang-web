import { NextResponse } from "next/server";

import { parsePriceUpload, processPriceUpload } from "@/lib/admin/priceUpload";
import { persistAdminJsonEvidence } from "@/lib/admin/priceUploadEvidence";
import { createSupabasePriceUploadRepository } from "@/lib/admin/priceUploadSupabase";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 2 * 1024 * 1024;

type BoundedBody =
  | { status: "ok"; text: string }
  | { status: "invalid" }
  | { status: "too_large" };

async function readBoundedBody(request: Request): Promise<BoundedBody> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) return { status: "invalid" };
    if (bytes > MAX_BODY_BYTES) return { status: "too_large" };
  }
  if (!request.body) return { status: "ok", text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel("price upload too large").catch(() => undefined);
        return { status: "too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { status: "ok", text };
  } catch {
    return { status: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const admin = await verifyAdmin(request);
  if (!admin.authorized || !admin.userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  const body = await readBoundedBody(request);
  if (body.status === "too_large") {
    return NextResponse.json(
      { error: "Price upload too large" },
      { status: 413, headers: PRIVATE_HEADERS },
    );
  }
  let raw: unknown;
  try {
    if (body.status === "invalid") throw new Error("invalid body");
    raw = JSON.parse(body.text);
  } catch {
    return NextResponse.json(
      { error: "Invalid price upload", issues: [{ path: "", message: "유효한 JSON이 아닙니다." }] },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const parsed = parsePriceUpload(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid price upload", issues: parsed.issues.slice(0, 20) },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const client = getServiceClient();
    const evidence = await persistAdminJsonEvidence(client, body.text);
    const repository = createSupabasePriceUploadRepository(client);
    const report = await processPriceUpload(parsed.data, repository, {
      actorId: admin.userId,
      objectKey: evidence.objectKey,
    });
    return NextResponse.json(report, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Price upload unavailable" },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
