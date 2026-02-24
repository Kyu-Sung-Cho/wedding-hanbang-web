import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

export function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 관리자 인증 확인 (Supabase Auth + is_admin 또는 비밀번호 헤더)
export async function verifyAdmin(request: Request): Promise<{ authorized: boolean; userId?: string }> {
  // 1. 비밀번호 헤더 확인 (하위 호환)
  const password = request.headers.get("x-admin-password");
  if (password === ADMIN_PASSWORD) {
    return { authorized: true };
  }

  // 2. Supabase Auth + is_admin 확인
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { authorized: false };

    const serviceClient = getServiceClient();
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (profile?.is_admin === true) {
      return { authorized: true, userId: user.id };
    }
  } catch {
    // 인증 실패
  }

  return { authorized: false };
}
