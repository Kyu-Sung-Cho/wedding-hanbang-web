import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecord } from "@/utils/requestValidation";
import { log } from "@/utils/log";

export type ConfirmedWeddingRole = "bride" | "groom" | null;
export interface ProfileWeddingRole {
  user_id: string;
  confirmed_role: ConfirmedWeddingRole;
  revision: string | null;
}
interface VisibleProfileWeddingRole extends ProfileWeddingRole { couple_id: string | null }
export const PROFILE_ROLE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
export class ProfileRoleError extends Error {
  constructor(public code = "PROFILE_ROLE_UNAVAILABLE", public status = 503) { super(code); }
}
export function isConfirmedWeddingRole(value: unknown): value is ConfirmedWeddingRole {
  return value === null || value === "bride" || value === "groom";
}
export function isRoleRevision(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}
function parseRole(value: unknown): ProfileWeddingRole | null {
  if (!isRecord(value) || typeof value.user_id !== "string" || !isRoleRevision(value.user_id)
    || !isConfirmedWeddingRole(value.confirmed_role) || !isRoleRevision(value.revision)
    || (value.confirmed_role !== null && value.revision === null)) return null;
  return { user_id: value.user_id, confirmed_role: value.confirmed_role, revision: value.revision };
}
async function readVisibleRoles(admin: SupabaseClient, userId: string): Promise<VisibleProfileWeddingRole[]> {
  const { data, error } = await admin.rpc("read_profile_wedding_roles", { p_user_id: userId });
  if (error || !Array.isArray(data) || data.length < 1 || data.length > 2) throw new ProfileRoleError();
  const rows: VisibleProfileWeddingRole[] = [];
  for (const value of data) {
    const row = parseRole(value);
    if (!row || !isRecord(value) || !isRoleRevision(value.couple_id) || rows.some(item => item.user_id === row.user_id)) throw new ProfileRoleError();
    rows.push({ ...row, couple_id: value.couple_id });
  }
  if (!rows.some(row => row.user_id === userId)) throw new ProfileRoleError();
  return rows;
}
export async function readProfileWeddingRole(admin: SupabaseClient, userId: string): Promise<ProfileWeddingRole> {
  const current = (await readVisibleRoles(admin, userId)).find(row => row.user_id === userId);
  if (!current) throw new ProfileRoleError();
  return { user_id: current.user_id, confirmed_role: current.confirmed_role, revision: current.revision };
}
// 실패 시 속성 생략, 성공한 미선택은 null. 로그인과 기존 선택을 조회 장애로 지우지 않는다.
export async function readOptionalProfileWeddingRoles(admin: SupabaseClient | (() => SupabaseClient), userId: string): Promise<Map<string, VisibleProfileWeddingRole>> {
  try { return new Map((await readVisibleRoles(typeof admin === "function" ? admin() : admin, userId)).map(row => [row.user_id, row])); }
  catch { log.error("profile-role:optional-read-failed", new Error("PROFILE_ROLE_UNAVAILABLE")); return new Map(); }
}
export async function saveProfileWeddingRole(admin: SupabaseClient, userId: string, role: ConfirmedWeddingRole, expectedRevision: string | null): Promise<ProfileWeddingRole> {
  const { data, error } = await admin.rpc("save_profile_wedding_role", {
    p_user_id: userId, p_confirmed_role: role, p_expected_revision: expectedRevision,
  });
  if (error) {
    const conflict = isRecord(error) && error.code === "P0001" && error.message === "PROFILE_ROLE_CONFLICT";
    throw new ProfileRoleError(conflict ? "PROFILE_ROLE_CONFLICT" : "PROFILE_ROLE_UNAVAILABLE", conflict ? 409 : 503);
  }
  const saved = parseRole(data);
  if (!saved || saved.user_id !== userId || saved.confirmed_role !== role || saved.revision === null || saved.revision === expectedRevision) throw new ProfileRoleError();
  const current = await readProfileWeddingRole(admin, userId);
  if (current.revision !== saved.revision || current.confirmed_role !== role) throw new ProfileRoleError("PROFILE_ROLE_CONFLICT", 409);
  return current;
}
