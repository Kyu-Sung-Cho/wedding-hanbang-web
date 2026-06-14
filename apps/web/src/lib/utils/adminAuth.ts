import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 관리자 인증: Supabase Auth + is_admin 플래그만 허용
export async function verifyAdmin(request: Request): Promise<{ authorized: boolean; userId?: string }> {
  try {
    const supabase = await createClientFromRequest(request);
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
