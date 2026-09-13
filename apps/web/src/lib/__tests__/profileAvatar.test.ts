// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProfileAvatarPath, profileAvatarPresentation, readOptionalProfileAvatars, sanitizeProfileAvatar, saveProfileAvatar } from "../profileAvatar";
import { buildProfileAvatarDeletionManifest } from "../accountDeletion/communityStorageSaga";
const USER = "11111111-1111-4111-8111-111111111111";
const OLD = "22222222-2222-4222-8222-222222222222";
const old = { user_id: USER, kind: "photo" as const, emoji: null, object_path: `${USER}/${OLD}.webp`, revision: OLD, updated_at: "2026-09-12T00:00:00Z" };
function fixture(mode = "success") {
  let current = old;
  let lateCommit: (() => void) | null = null;
  const remove = vi.fn(async () => ({ error: null }));
  const upload = vi.fn(async () => ({ error: mode === "upload-failed" ? { message: "no" } : null }));
  let read = 0;
  const maybeSingle = vi.fn(async () => {
    read++;
    return mode === "readback-failed" && read > 1 ? { data: null, error: { message: "offline" } } : { data: current, error: null };
  });
  const admin = {
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }), in: async () => ({ data: [current], error: null }) }) })),
    rpc: vi.fn(async (name: string, p: Record<string, string | null>) => {
      if (name === "read_profile_avatar_snapshot") return { data: [current], error: null };
      if (name === "register_profile_avatar_asset") return { data: { object_path: `${USER}/${p.p_revision}.webp` }, error: null };
      if (mode === "save-failed") return { data: null, error: { code: "P0001", message: "PROFILE_AVATAR_CONFLICT" } };
      const next = { ...old, kind: p.p_kind as "photo", emoji: p.p_emoji as null, object_path: p.p_kind === "photo" ? `${USER}/${p.p_revision}.webp` : null as unknown as string, revision: String(p.p_revision) };
      if (mode === "late-commit-error" || mode === "late-commit-throw") {
        lateCommit = () => { current = next; };
        if (mode === "late-commit-throw") throw new Error("network interrupted");
        return { data: null, error: { message: "connection interrupted" } };
      }
      current = next;
      if (mode === "throw-after-commit") throw new Error("network interrupted");
      return { data: current, error: mode === "error-after-commit" ? { message: "network" } : null };
    }),
    storage: { from: () => ({ upload, remove }) },
  };
  return { admin: admin as unknown as SupabaseClient, remove, upload, rpc: admin.rpc, current: () => current, finishLateCommit: () => lateCommit?.() };
}
async function photo() { return { kind: "photo" as const, bytes: await sharp({ create: { width: 300, height: 120, channels: 3, background: "red" } }).png().toBuffer(), mimeType: "image/png" }; }
describe("private profile avatar storage boundary", () => {
  it("accepts only exact owner-scoped generated paths", () => {
    expect(isProfileAvatarPath(old.object_path, USER)).toBe(true);
    for (const value of [`${USER}/../${OLD}.webp`, `${OLD}/${OLD}.webp`, "https://evil.test/a.webp", `${USER}/${OLD}.webp?q=1`]) expect(isProfileAvatarPath(value, USER)).toBe(false);
    expect(profileAvatarPresentation(old).avatar_url).toBe(`/api/profile/avatar/image?userId=${USER}&version=${OLD}`);
  });
  it("decodes and reduces photo bytes to metadata-free 256px WebP", async () => {
    const fixturePhoto = await photo();
    const input = await sharp(fixturePhoto.bytes).withMetadata({ exif: { IFD0: { Artist: "Synthetic QA only" } } }).jpeg().toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const source = { bytes: input, mimeType: "image/jpeg" }; const result = await sanitizeProfileAvatar(source.bytes, source.mimeType);
    expect(await sharp(result).metadata()).toMatchObject({ width: 256, height: 256, format: "webp" });
    expect((await sharp(result).metadata()).exif).toBeUndefined();
    await expect(sanitizeProfileAvatar(source.bytes, "image/png")).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(sanitizeProfileAvatar(new Uint8Array(4 * 1024 * 1024 + 1), "image/png")).rejects.toMatchObject({ status: 413 });
    await expect(sanitizeProfileAvatar(new TextEncoder().encode("<svg/>"), "image/svg+xml")).rejects.toMatchObject({ status: 400 });
  });
  it.each(["success", "error-after-commit", "throw-after-commit"])("confirms committed photo and keeps it for %s", async mode => {
    const f = fixture(mode); const result = await saveProfileAvatar(f.admin, USER, await photo(), OLD);
    expect(result.revision).toBe(f.current().revision);
    expect(f.remove.mock.calls.flat(2)).not.toContain(f.current().object_path);
    if (mode !== "throw-after-commit") expect(f.remove).toHaveBeenCalledWith([old.object_path]);
  });
  it("preserves old photo and removes only failed uncommitted upload", async () => {
    const f = fixture("save-failed"); await expect(saveProfileAvatar(f.admin, USER, await photo(), OLD)).rejects.toMatchObject({ code: "AVATAR_SAVE_CONFLICT" });
    expect(f.current()).toEqual(old); expect(f.remove).toHaveBeenCalledTimes(1); expect(f.remove).not.toHaveBeenCalledWith([old.object_path]);
  });
  it("does not remove any bytes when readback cannot confirm commit state", async () => {
    const f = fixture("readback-failed"); await expect(saveProfileAvatar(f.admin, USER, await photo(), OLD)).rejects.toMatchObject({ code: "PROFILE_AVATAR_UNAVAILABLE" });
    expect(f.remove).not.toHaveBeenCalled();
  });
  it.each(["late-commit-error", "late-commit-throw"])("preserves newly uploaded bytes while database commit may still arrive: %s", async mode => {
    const f = fixture(mode);
    await expect(saveProfileAvatar(f.admin, USER, await photo(), OLD)).rejects.toMatchObject({ code: "AVATAR_SAVE_FAILED" });
    expect(f.current()).toEqual(old);
    f.finishLateCommit();
    expect(f.current().revision).not.toBe(OLD);
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("rejects a stale editor revision before registering or uploading new photo bytes", async () => {
    const f=fixture();
    await expect(saveProfileAvatar(f.admin,USER,await photo(),null)).rejects.toMatchObject({code:"AVATAR_SAVE_CONFLICT",status:409});
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
  });
  it("sends the editor revision unchanged to the database compare-and-set", async () => {
    const f=fixture(); await saveProfileAvatar(f.admin,USER,{kind:"initial"},OLD);
    expect(f.rpc).toHaveBeenCalledWith("save_profile_avatar",expect.objectContaining({p_expected_revision:OLD}));
  });
  it("upload failure never changes the selected row", async () => {
    const f = fixture("upload-failed"); await expect(saveProfileAvatar(f.admin, USER, await photo(), OLD)).rejects.toMatchObject({ code: "AVATAR_SAVE_FAILED" });
    expect(f.current()).toEqual(old); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("resets to initial and retires previous photo only after readback", async () => {
    const f = fixture(); const result = await saveProfileAvatar(f.admin, USER, { kind: "initial" }, OLD);
    expect(result.avatar_url).toBeNull(); expect(f.upload).not.toHaveBeenCalled(); expect(f.remove).toHaveBeenCalledWith([old.object_path]);
  });
  it("optional auth projection ignores non-allowed owners and missing schema", async () => {
    const f = fixture(); expect(await readOptionalProfileAvatars(f.admin, [OLD])).toEqual(new Map([[OLD, { avatar_url: null, revision: null }]]));
    const broken = { from: () => { throw new Error("missing schema"); } } as unknown as SupabaseClient;
    expect(await readOptionalProfileAvatars(broken, [USER])).toEqual(new Map());
  });
  it("distinguishes confirmed empty selection from failed or malformed optional data", async () => {
    const query = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as unknown as SupabaseClient;
    expect((await readOptionalProfileAvatars(query([]), [USER])).get(USER)).toEqual({ avatar_url: null, revision: null });
    expect(await readOptionalProfileAvatars(query(null, { message: "offline" }), [USER])).toEqual(new Map());
    expect(await readOptionalProfileAvatars(query([{ ...old, object_path: "https://foreign.test/photo" }]), [USER])).toEqual(new Map());
  });
  it("deletion includes registered paths before upload, waits for expiry and quarantines unknown files", () => {
    const until = "2026-09-12T00:10:00Z";
    const result = buildProfileAvatarDeletionManifest(USER, [{ ...old, upload_until: until }], ["unregistered.webp"], Date.parse("2026-09-12T00:00:00Z"));
    expect(result).toContainEqual({ bucket: "profile-avatars", path: old.object_path, source: "profile_avatar", not_before: until });
    expect(result).toContainEqual(expect.objectContaining({ source: "quarantine" }));
    expect(() => buildProfileAvatarDeletionManifest(USER, [{ ...old, object_path: `${OLD}/${OLD}.webp`, upload_until: until }], [], Date.now())).toThrow();
  });
});
