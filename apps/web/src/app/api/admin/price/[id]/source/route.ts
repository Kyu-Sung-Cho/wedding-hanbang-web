import { NextResponse } from "next/server";
import { z } from "zod";
import { isSafeDisclosureObjectKey, sourceFileLabels } from "@/lib/admin/vendorWorkspace";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";

const DISCLOSURE_BUCKET = "disclosure-raw";
const DISCLOSURE_PREVIEW_BUCKET = "disclosure-preview";
const SIGNED_URL_TTL_SECONDS = 300;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW_FILES = 16;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function isSafePreviewObjectKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}\.txt$/u.test(value);
}

function supportsTextPreview(label: string): boolean {
  return /\.(?:xlsx|docx|pdf)$/iu.test(label);
}

function supportsInlineJsonPreview(label: string): boolean {
  return /\.json$/iu.test(label);
}

type SourceFileResponse = {
  label: string;
  signed_url: string;
  preview_text?: string;
};

async function downloadPreviewText(
  storage: ReturnType<ReturnType<typeof getServiceClient>["storage"]["from"]>,
  key: string,
): Promise<{ text: string; bytes: number }> {
  const { data, error } = await storage.download(key);
  if (error || !data || data.size > MAX_PREVIEW_BYTES) {
    throw new Error("preview_download_failed");
  }
  const bytes = await data.arrayBuffer();
  if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error("preview_size_limit");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("preview_text_invalid");
  return { text, bytes: bytes.byteLength };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return privateJson({ error: "Unauthorized" }, 401);
  }

  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) {
    return privateJson({ error: "원본 파일을 찾을 수 없습니다." }, 404);
  }
  const kind = z.enum(["price", "agency_package"]).safeParse(
    new URL(request.url).searchParams.get("kind") ?? "price",
  );
  if (!kind.success) {
    return privateJson({ error: "원본 파일 유형을 확인해 주세요." }, 400);
  }

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from(kind.data === "agency_package" ? "official_agency_packages" : "official_prices")
      .select("source_file, source_object_keys, source_preview_keys")
      .eq("id", parsedId.data)
      .single();

    const rawKeys: unknown = data?.source_object_keys;
    const keys = Array.isArray(rawKeys) && rawKeys.every((value) => typeof value === "string")
      ? rawKeys
      : null;
    const rawPreviewKeys: unknown = data?.source_preview_keys;
    const previewKeys = rawPreviewKeys === undefined
      ? []
      : Array.isArray(rawPreviewKeys) && rawPreviewKeys.every((value) => typeof value === "string")
        ? rawPreviewKeys
        : null;
    if (error || !keys || !previewKeys || keys.length === 0 || !keys.every(isSafeDisclosureObjectKey)) {
      return privateJson({ error: "원본 파일을 찾을 수 없습니다." }, 404);
    }

    const rawStorage = client.storage.from(DISCLOSURE_BUCKET);
    const { data: signed, error: signError } = await rawStorage
      .createSignedUrls(keys, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed || signed.length !== keys.length || signed.some((item) => !item.signedUrl)) {
      return privateJson(
        { error: "원본 파일 링크를 만들지 못했습니다. 다시 시도해 주세요." },
        503,
      );
    }

    const auditLabels = sourceFileLabels(data.source_file);
    const files: SourceFileResponse[] = signed.map((item, index) => ({
      label: auditLabels[index] ?? `원본 ${index + 1}`,
      signed_url: item.signedUrl,
    }));

    if (new URL(request.url).searchParams.get("redirect") === "1") {
      const rawIndex = Number(new URL(request.url).searchParams.get("index") ?? "0");
      const index = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < files.length ? rawIndex : 0;
      const response = NextResponse.redirect(files[index].signed_url, { status: 307 });
      Object.entries(PRIVATE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
      return response;
    }

    let totalPreviewBytes = 0;
    for (const [index, label] of auditLabels.entries()) {
      if (!supportsInlineJsonPreview(label) || !keys[index] || !files[index]) continue;
      const preview = await downloadPreviewText(rawStorage, keys[index]);
      totalPreviewBytes += preview.bytes;
      if (totalPreviewBytes > MAX_PREVIEW_TOTAL_BYTES) {
        throw new Error("preview_total_size_limit");
      }
      try {
        JSON.parse(preview.text);
      } catch {
        throw new Error("json_preview_invalid");
      }
      files[index].preview_text = preview.text;
    }

    const previewIndexes = auditLabels.flatMap((label, index) =>
      supportsTextPreview(label) ? [index] : []
    );
    if (
      previewKeys.length > MAX_PREVIEW_FILES
      || !previewKeys.every(isSafePreviewObjectKey)
      || (previewKeys.length > 0
        && (auditLabels.length !== keys.length || previewIndexes.length !== previewKeys.length))
    ) {
      return privateJson({ error: "원본 미리보기 정보를 확인할 수 없습니다." }, 404);
    }
    if (previewKeys.length > 0) {
      const previewStorage = client.storage.from(DISCLOSURE_PREVIEW_BUCKET);
      const previewTexts: string[] = [];
      for (const key of previewKeys) {
        const preview = await downloadPreviewText(previewStorage, key);
        totalPreviewBytes += preview.bytes;
        if (totalPreviewBytes > MAX_PREVIEW_TOTAL_BYTES) throw new Error("preview_total_size_limit");
        previewTexts.push(preview.text);
      }
      previewTexts.forEach((previewText, index) => {
        const fileIndex = previewIndexes[index];
        if (fileIndex !== undefined && files[fileIndex]) files[fileIndex].preview_text = previewText;
      });
    }

    return privateJson({
      files,
      expires_in: SIGNED_URL_TTL_SECONDS,
    });
  } catch {
    return privateJson(
      { error: "원본 파일 링크를 만들지 못했습니다. 다시 시도해 주세요." },
      503,
    );
  }
}
