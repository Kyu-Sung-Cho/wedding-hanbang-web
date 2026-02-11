import { createClient } from "@/lib/supabase/client";

interface CoupleInfo {
  id: string;
  invite_code: string;
  bride_id: string | null;
  groom_id: string | null;
  created_at: string;
}

interface PartnerInfo {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
}

// 내 커플 정보 가져오기
export async function getMyCouple(userId: string): Promise<{
  couple: CoupleInfo | null;
  myRole: string | null;
  coupleId: string | null;
}> {
  const supabase = createClient();

  // 프로필에서 couple_id 가져오기
  const { data: profile } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .single();

  if (!profile?.couple_id) {
    return { couple: null, myRole: profile?.role || null, coupleId: null };
  }

  // 커플 정보 가져오기
  const { data: couple } = await supabase
    .from("couples")
    .select("*")
    .eq("id", profile.couple_id)
    .single();

  return {
    couple: couple as CoupleInfo | null,
    myRole: profile.role,
    coupleId: profile.couple_id,
  };
}

// 파트너 정보 가져오기
export async function getPartnerInfo(userId: string): Promise<PartnerInfo | null> {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  if (!profile?.couple_id) return null;

  const { data: partner } = await supabase
    .from("profiles")
    .select("id, email, name, role")
    .eq("couple_id", profile.couple_id)
    .neq("id", userId)
    .single();

  return partner as PartnerInfo | null;
}

// 커플 생성
export async function createCouple(userId: string, role: "bride" | "groom") {
  const supabase = createClient();

  // 초대 코드 생성
  const inviteCode = generateInviteCode();
  const roleField = role === "bride" ? "bride_id" : "groom_id";

  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .insert({
      invite_code: inviteCode,
      [roleField]: userId,
    })
    .select()
    .single();

  if (coupleError) {
    console.error("커플 생성 실패:", coupleError);
    return null;
  }

  // 프로필에 couple_id 연결
  await supabase
    .from("profiles")
    .upsert(
      { id: userId, couple_id: couple.id, role },
      { onConflict: "id" }
    );

  // 여정 생성
  await supabase
    .from("wedding_journeys")
    .upsert(
      { couple_id: couple.id },
      { onConflict: "couple_id", ignoreDuplicates: true }
    );

  return couple as CoupleInfo;
}

// 초대 코드로 커플 참여
export async function joinCouple(userId: string, inviteCode: string, role: "bride" | "groom") {
  const supabase = createClient();

  const { data: couple, error: findError } = await supabase
    .from("couples")
    .select("*")
    .eq("invite_code", inviteCode.toUpperCase())
    .single();

  if (findError || !couple) {
    return { success: false, error: "유효하지 않은 초대 코드입니다." };
  }

  const roleField = role === "bride" ? "bride_id" : "groom_id";

  if (couple[roleField]) {
    return { success: false, error: "이미 해당 역할이 등록되어 있습니다." };
  }

  const { error: updateError } = await supabase
    .from("couples")
    .update({ [roleField]: userId })
    .eq("id", couple.id);

  if (updateError) {
    return { success: false, error: "커플 참여 실패" };
  }

  await supabase
    .from("profiles")
    .upsert(
      { id: userId, couple_id: couple.id, role },
      { onConflict: "id" }
    );

  return { success: true, couple: couple as CoupleInfo };
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
