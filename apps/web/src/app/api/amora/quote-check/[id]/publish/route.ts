import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}
async function setPublication(
  request: Request,
  id: string,
  publish: boolean,
) {
  if (!isTrustedMutationRequest(request)) {
    return privateJson({ error: "허용되지 않은 요청 출처입니다." }, 403);
  }
  if (!isUuid(id)) {
    return privateJson({ error: "잘못된 결과 ID입니다." }, 400);
  }

  const authClient = await createClientFromRequest(request);
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return privateJson({ error: "로그인이 필요합니다." }, 401);
  }

  const limited = await checkRateLimitPersistent(
    rateLimitKey("amora:quote-check:publish", request, user.id),
    { maxRequests: 20, windowMs: 60 * 60 * 1_000 },
  );
  if (limited) {
    for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
      limited.headers.set(name, value);
    }
    return limited;
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return privateJson({ error: "공개 설정을 변경할 수 없습니다." }, 503);
  }

  const publishedAt = publish ? new Date().toISOString() : null;
  const { data, error } = await admin
    .from("amora_quote_checks")
    .update({ published_at: publishedAt })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, published_at")
    .maybeSingle();

  if (error) {
    return privateJson({ error: "공개 설정을 변경할 수 없습니다." }, 503);
  }
  if (!data) {
    return privateJson({ error: "결과를 찾을 수 없습니다." }, 404);
  }

  return privateJson({
    id: data.id,
    published: data.published_at !== null,
    publicPath: data.published_at !== null ? `/quote/${data.id}` : null,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return setPublication(request, id, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return setPublication(request, id, false);
}
