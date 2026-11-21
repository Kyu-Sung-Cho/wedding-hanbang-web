"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PROFILE_AVATAR_EMOJIS, isProfileAvatarEmoji } from "@hanbang/shared/profile-avatar";
import ProfileAvatar from "@/components/ui/ProfileAvatar";
import Button from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";

type AvatarKind = "initial" | "emoji" | "photo";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const optionClass = "!min-h-11 !rounded-lg !px-3 !py-2";
const selectedClass = "aria-pressed:border-[var(--hb-selected-line)] aria-pressed:bg-[var(--hb-selected-bg)] aria-pressed:text-[var(--hb-selected-text)] aria-pressed:hover:bg-[var(--hb-selected-bg)]";

const READ_TIMEOUT_MS = 15_000;
const SAVE_TIMEOUT_MS = 30_000;
/** 서버 값을 다시 읽어 편집기를 맞춘 뒤의 안내. 편집기가 이미 지금 저장된 값을 보여 준다. */
const REFRESHED_MESSAGE = "프로필이 이미 바뀌었어요. 지금 저장된 모습을 확인해 주세요.";

function saveErrorMessage(code: unknown): string {
  if (code === "AUTH_REQUIRED") return "로그인 상태를 다시 확인해 주세요.";
  if (code === "AVATAR_OWNER_CHANGED") return "계정 상태가 바뀌었어요. 현재 계정으로 프로필을 다시 열어 주세요.";
  if (code === "INVALID_IMAGE" || code === "INVALID_AVATAR") return "사진을 읽을 수 없어요. 다른 JPG, PNG, WebP 사진을 선택해 주세요.";
  if (code === "AVATAR_TOO_LARGE") return "4MB 이하의 사진을 선택해 주세요.";
  // 누가 바꿨는지는 모른다. 같은 브라우저의 직전 요청이 늦게 저장됐을 수도 있다.
  if (code === "AVATAR_SAVE_CONFLICT") return "프로필이 이미 바뀌었어요. 취소한 뒤 다시 열어 확인해 주세요.";
  if (code === "RATE_LIMITED") return "프로필을 너무 자주 바꿨어요. 잠시 뒤 다시 시도해 주세요.";
  return "프로필 저장 결과를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

type AvatarState = { avatar_url: string | null; revision: string | null };
type SaveOutcome =
  | { type: "saved"; avatarUrl: string | null }
  | { type: "refreshed"; avatarUrl: string | null; revision: string | null; message: string }
  | { type: "failed"; message: string };

/** 끊김(AbortError)과 네트워크 오류(fetch TypeError)는 요청이 서버에 닿았는지 모른다. */
function isTransportFailure(failure: unknown): boolean {
  return failure instanceof TypeError
    || (typeof failure === "object" && failure !== null && (failure as { name?: unknown }).name === "AbortError");
}

function isSavedSelection(kind: AvatarKind, emoji: string, saved: AvatarState): boolean {
  if (kind === "initial") return saved.avatar_url === null;
  if (kind === "emoji") return saved.avatar_url === emoji;
  return typeof saved.avatar_url === "string" && saved.avatar_url.startsWith("/api/profile/avatar/image?");
}

function parseAvatarResponse(value: unknown, ownerId: string, requireRevision = false): AvatarState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const validRevision = typeof record.revision === "string" && UUID.test(record.revision);
  if (record.avatar_url === null && (validRevision || (!requireRevision && record.revision === null))) return { avatar_url: null, revision: validRevision ? String(record.revision) : null };
  if (!validRevision) return null;
  if (isProfileAvatarEmoji(record.avatar_url)) return { avatar_url: record.avatar_url as string, revision: String(record.revision) };
  if (typeof record.avatar_url !== "string" || !record.avatar_url.startsWith("/api/profile/avatar/image?")) return null;
  const url = new URL(record.avatar_url, "https://hanbang.ai");
  if (url.pathname !== "/api/profile/avatar/image" || url.searchParams.get("userId") !== ownerId
    || url.searchParams.get("version") !== record.revision) return null;
  return { avatar_url: record.avatar_url, revision: String(record.revision) };
}

interface EditorProps {
  ownerId: string;
  coupleId: string | null;
  name: string;
  savedAvatar: string | null;
  isDemo: boolean;
  onClose: (saved: boolean) => void;
}

function AvatarChoices({ ownerId, coupleId, name, savedAvatar, isDemo, onClose }: EditorProps) {
  const [baseline, setBaseline] = useState(savedAvatar);
  const [expectedRevision, setExpectedRevision] = useState<string | null>(null);
  const [kind, setKind] = useState<AvatarKind>(isProfileAvatarEmoji(savedAvatar) ? "emoji" : savedAvatar ? "photo" : "initial");
  const [emoji, setEmoji] = useState(isProfileAvatarEmoji(savedAvatar) ? savedAvatar! : PROFILE_AVATAR_EMOJIS[0].emoji);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ready, setReady] = useState(isDemo);
  const [loading, setLoading] = useState(!isDemo);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileId = useId();

  const stillOwnsProfile = () => {
    const current = useAuthStore.getState();
    return active.current && current.isDemo === isDemo && current.profile?.id === ownerId
      && (current.profile.couple_id ?? null) === coupleId && (isDemo || current.user?.id === ownerId);
  };

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let cancelled = false;
    fetch("/api/profile/avatar", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = parseAvatarResponse(await response.json().catch(() => null), ownerId);
        if (cancelled || !active.current) return;
        if (!response.ok || !data) throw new Error("unavailable");
        setBaseline(data.avatar_url);
        setExpectedRevision(data.revision);
        setKind(isProfileAvatarEmoji(data.avatar_url) ? "emoji" : data.avatar_url ? "photo" : "initial");
        if (isProfileAvatarEmoji(data.avatar_url)) setEmoji(data.avatar_url!);
        setReady(true);
      })
      .catch(() => { if (!cancelled && active.current) setError("프로필을 불러오지 못했어요. 다시 시도해 주세요."); })
      .finally(() => { clearTimeout(timer); if (!cancelled && active.current) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [ownerId, isDemo, retry]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => { URL.revokeObjectURL(url); };
  }, [photo]);

  const applyAvatar = (avatarUrl: string | null) => {
    useAuthStore.setState((current) => current.profile?.id === ownerId
      && (current.profile.couple_id ?? null) === coupleId
      ? { profile: { ...current.profile, avatar_url: avatarUrl } } : {});
  };

  /** 표시용 GET. 실패(오류 응답·네트워크·모양 불일치·타임아웃)는 null — 무엇도 단정하지 않는다. */
  async function readSavedAvatar(): Promise<AvatarState | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
      const response = await fetch("/api/profile/avatar", { cache: "no-store", signal: controller.signal });
      if (!response.ok) return null;
      return parseAvatarResponse(await response.json().catch(() => null), ownerId);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 저장 한 번. 결과를 모르는 실패(끊김, 네트워크 오류, 5xx, 모양이 틀린 2xx, 저장 충돌)는 서버 값을
   * 다시 읽어 판단한다. 끊긴 요청이 늦게 커밋되면 다시 누른 저장이 409가 되는데, 그걸 「누가 바꿨다」로
   * 안내하지 않는다. 앱 apps/mobile/src/lib/profileAvatarPresentation.mjs saveProfileAvatarSelection 과 같은 판정이다.
   */
  async function sendSelection(body: FormData | string, selectedKind: AvatarKind, selectedEmoji: string, sentRevision: string | null): Promise<SaveOutcome> {
    let code: unknown = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
    try {
      const response = await fetch("/api/profile/avatar", {
        method: "PUT", body, signal: controller.signal,
        headers: typeof body === "string" ? { "Content-Type": "application/json" } : undefined,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const data = parseAvatarResponse(payload, ownerId, true);
        if (data && isSavedSelection(selectedKind, selectedEmoji, data)) return { type: "saved", avatarUrl: data.avatar_url };
        // 2xx 인데 모양이 틀렸다. 서버는 저장했을 수 있다.
      } else {
        code = response.status === 429 ? "RATE_LIMITED" : payload && typeof payload === "object" ? (payload as Record<string, unknown>).code ?? null : null;
        const outcomeUnknown = response.status >= 500 || response.status === 408 || response.status < 400
          || code === "AVATAR_SAVE_CONFLICT";
        if (!outcomeUnknown) return { type: "failed", message: saveErrorMessage(code) };
      }
    } catch (failure) {
      // 요청을 보내기 전에 멈춘 오류는 서버에 닿지 않았다.
      if (!isTransportFailure(failure)) return { type: "failed", message: saveErrorMessage(null) };
    } finally {
      clearTimeout(timer);
    }

    // 계정이 바뀌었으면 다른 계정의 값을 읽지 않는다.
    if (!stillOwnsProfile()) return { type: "failed", message: saveErrorMessage(null) };
    const current = await readSavedAvatar();
    if (!current) return { type: "failed", message: saveErrorMessage(code) };
    // 서버 값이 그대로다. 아직 처리 중일 수 있어 저장됐다고도, 안 됐다고도 단정하지 않는다.
    if (current.revision === sentRevision) return { type: "failed", message: saveErrorMessage(null) };
    // 사진은 서버가 다시 인코딩하고 revision을 새로 만들어 같은 사진인지 증명할 수 없다.
    if (selectedKind !== "photo" && isSavedSelection(selectedKind, selectedEmoji, current)) return { type: "saved", avatarUrl: current.avatar_url };
    return { type: "refreshed", avatarUrl: current.avatar_url, revision: current.revision, message: REFRESHED_MESSAGE };
  }

  async function save() {
    if (inFlight.current || !ready || !stillOwnsProfile()) return;
    if (kind === "photo" && (!photo || isDemo)) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      if (isDemo) {
        applyAvatar(kind === "emoji" ? emoji : null);
        onClose(true);
        return;
      }
      let body: FormData | string;
      if (kind === "photo" && photo) {
        body = new FormData();
        body.append("photo", photo);
        body.append("expected_revision", expectedRevision ?? "null");
        body.append("expected_user_id", ownerId);
      } else body = JSON.stringify(kind === "emoji" ? { kind, emoji, expected_revision: expectedRevision, expected_user_id: ownerId } : { kind: "initial", expected_revision: expectedRevision, expected_user_id: ownerId });
      const outcome = await sendSelection(body, kind, emoji, expectedRevision ?? null);
      if (!stillOwnsProfile()) return;
      if (outcome.type === "saved") {
        applyAvatar(outcome.avatarUrl);
        onClose(true);
        return;
      }
      if (outcome.type === "refreshed") {
        // 편집기를 서버에 저장된 값으로 맞춘다. 고른 사진은 내려놓아 미리보기가 저장된 모습을 보여 준다.
        setBaseline(outcome.avatarUrl);
        setExpectedRevision(outcome.revision);
        setKind(isProfileAvatarEmoji(outcome.avatarUrl) ? "emoji" : outcome.avatarUrl ? "photo" : "initial");
        if (isProfileAvatarEmoji(outcome.avatarUrl)) setEmoji(outcome.avatarUrl!);
        setPhoto(null);
        setPreview(null);
        applyAvatar(outcome.avatarUrl);
      }
      setError(outcome.message);
    } catch {
      if (stillOwnsProfile()) setError(saveErrorMessage(null));
    } finally {
      inFlight.current = false;
      if (active.current) setSaving(false);
    }
  }

  const previewAvatar = kind === "initial" ? null : kind === "emoji" ? emoji : baseline;
  return (
    <div className="mt-3 rounded-xl border border-[#E5D8CA] bg-[#FBF8F2] p-4 sm:p-5" aria-label="프로필 꾸미기">
      <p className="text-sm leading-6 text-[#635B51]">나와 연결된 상대에게 보여요.</p>
      {loading && <p role="status" className="mt-3 text-sm text-[#635B51]">프로필을 불러오는 중이에요.</p>}
      {ready && <>
        <div className="my-5 flex justify-center"><ProfileAvatar name={name} avatarUrl={previewAvatar} previewUrl={kind === "photo" && photo ? preview : null} size={80} /></div>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="프로필 표시 방식">
          {([{ kind: "initial", label: "기본 글자" }, { kind: "emoji", label: "이모지" }, { kind: "photo", label: "사진" }] as const).map((option) => (
            <Button key={option.kind} variant="secondary" size="sm" type="button" aria-pressed={kind === option.kind} disabled={saving}
              className={`${optionClass} ${selectedClass}`}
              onClick={() => { setKind(option.kind); setError(""); }}>{option.label}</Button>
          ))}
        </div>
        {kind === "initial" && <p className="mt-4 text-sm text-[#635B51]">이름의 첫 글자로 표시해요.</p>}
        {kind === "emoji" && <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-5" role="group" aria-label="프로필 이모지 선택">
          {PROFILE_AVATAR_EMOJIS.map((option) => <Button key={option.emoji} variant="secondary" size="sm" type="button" aria-label={option.label} aria-pressed={emoji === option.emoji}
            disabled={saving} className={`${optionClass} !text-[24px] ${selectedClass}`}
            onClick={() => { setEmoji(option.emoji); setError(""); }}>{option.emoji}</Button>)}
        </div>}
        {kind === "photo" && <div className="mt-4">
          <Button variant="secondary" size="sm" type="button" disabled={saving} className={optionClass} onClick={() => fileInput.current?.click()}>{photo ? "사진 바꾸기" : "사진 고르기"}</Button>
          <input ref={fileInput} id={fileId} aria-label="프로필 사진 선택" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("JPG, PNG, WebP 사진을 선택해 주세요."); return; }
              if (file.size > MAX_PHOTO_BYTES || file.size === 0) { setError("내용이 있는 4MB 이하 사진을 선택해 주세요."); return; }
              setPhoto(file); setError("");
            }} />
          {photo && <p role="status" className="mt-2 break-all text-sm text-[#635B51]">선택한 사진: {photo.name}</p>}
          <p className="mt-2 text-xs leading-5 text-[#635B51]">JPG · PNG · WebP, 최대 4MB. 사진 가운데가 원 안에 표시돼요.</p>
          {isDemo && <p className="mt-2 text-sm text-[#7D5753]">사진 저장은 로그인 후 사용할 수 있어요.</p>}
        </div>}
      </>}
      {error && <p role="alert" className="mt-3 text-sm leading-6 text-[#9F3535]">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {!ready && !loading && <Button variant="secondary" size="sm" type="button" className={optionClass} onClick={() => { setError(""); setLoading(true); setRetry((value) => value + 1); }}>다시 불러오기</Button>}
        <Button variant="secondary" size="sm" type="button" disabled={saving} className={optionClass} onClick={() => onClose(false)}>취소</Button>
        {ready && <Button variant="primary" size="sm" type="button" disabled={saving || (kind === "photo" && (!photo || isDemo))} className={optionClass} onClick={() => { void save(); }}>{saving ? "저장 중…" : "저장"}</Button>}
      </div>
    </div>
  );
}

export default function ProfileAvatarEditor() {
  const { user, profile, isDemo } = useAuthStore();
  const [editingOwner, setEditingOwner] = useState<string | null>(null);
  const [noticeOwner, setNoticeOwner] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const ownerId = profile?.id ?? null;
  const binding = `${isDemo}:${user?.id ?? ""}:${ownerId}:${profile?.couple_id ?? ""}`;
  const open = !!ownerId && editingOwner === binding;
  if (!profile || (!isDemo && user?.id !== ownerId)) return null;
  return (
    <div className="mb-6">
      <Button ref={button} variant="secondary" size="sm" type="button" aria-expanded={open} aria-controls={panelId} className={optionClass}
        onClick={() => { if (!open) { setEditingOwner(binding); setNoticeOwner(null); } }}>프로필 꾸미기</Button>
      {noticeOwner === binding && <p role="status" className="mt-2 text-sm text-[#637465]">{isDemo ? "체험 프로필을 바꿨어요." : "프로필을 저장했어요."}</p>}
      <div id={panelId}>{open && <AvatarChoices key={binding} ownerId={profile.id} coupleId={profile.couple_id ?? null} name={profile.name} savedAvatar={profile.avatar_url} isDemo={isDemo}
        onClose={(saved) => { setEditingOwner(null); if (saved) setNoticeOwner(binding); button.current?.focus(); }} />}</div>
    </div>
  );
}
