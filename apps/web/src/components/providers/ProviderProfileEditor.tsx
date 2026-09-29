"use client";

import { useRef, useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import type { ProviderProfile } from "@/lib/providers/contracts";
import { providerFailure, providerJson, providerRequest } from "./providerClient";
import { providerInput, providerLabel } from "./ProviderShell";

type Props = { profile: ProviderProfile; onChanged: (message: string) => Promise<void> };

export default function ProviderProfileEditor({ profile, onChanged }: Props) {
  const [introduction, setIntroduction] = useState(profile.introduction);
  const [website, setWebsite] = useState(profile.website ?? "");
  const [instagram, setInstagram] = useState(profile.instagram ?? "");
  const [busy, setBusy] = useState<"save" | "publish" | "pause" | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const canEdit = profile.approval_status === "approved";
  const dirty = introduction.trim() !== profile.introduction || website.trim() !== (profile.website ?? "") || instagram.trim() !== (profile.instagram ?? "");

  async function mutate(action: "save" | "publish" | "pause") {
    if (inFlight.current || !canEdit || (action === "publish" && dirty)) return;
    inFlight.current = true; setBusy(action); setError("");
    try {
      await providerRequest(`/api/provider/profiles/${profile.id}`, providerJson("PATCH", {
        action, expected_version: profile.version,
        ...(action === "save" ? { introduction: introduction.trim(), website: website.trim() || null, instagram: instagram.trim() || null } : {}),
      }));
      await onChanged(action === "publish" ? "프로필을 공개했어요. 서비스와 추천 자격은 별도로 검토합니다." : action === "pause" ? "프로필 공개를 중단했어요." : profile.publication_status === "published" ? "소개글과 링크를 저장했고 공개 프로필에 반영했어요." : "소개글과 링크를 저장했어요. 아직 프로필은 비공개입니다.");
    } catch (cause) { setError(providerFailure(cause)); }
    finally { inFlight.current = false; setBusy(null); }
  }

  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void mutate("save"); }

  return (
    <section aria-labelledby="profile-editor-heading">
      <h2 id="profile-editor-heading" className="text-lg font-semibold text-[var(--hb-text-strong)]">소개글과 공개 링크</h2>
      <p className="mt-2 text-sm leading-7">공개 중인 프로필의 소개글과 사진은 저장하면 바로 반영됩니다. 가격과 서비스 조건은 아래 서비스 등록에서 따로 제출해 주세요.</p>
      <form onSubmit={save} className="mt-5 space-y-5">
        <fieldset disabled={!canEdit || busy !== null} className="space-y-5 disabled:opacity-60">
          <div><label htmlFor="profile-introduction" className={providerLabel}>소개글</label><textarea id="profile-introduction" value={introduction} onChange={(event) => setIntroduction(event.target.value)} maxLength={3000} rows={6} required className={providerInput} /><p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">공개할 활동 소개를 적어주세요. 고객 연락처와 비공개 계약 내용은 올리지 마세요.</p></div>
          <div><label htmlFor="profile-website" className={providerLabel}>웹사이트 <span className="font-normal">(선택)</span></label><input id="profile-website" type="url" pattern="https://.*" value={website} onChange={(event) => setWebsite(event.target.value)} maxLength={500} placeholder="https://" className={providerInput} /></div>
          <div><label htmlFor="profile-instagram" className={providerLabel}>인스타그램 링크 <span className="font-normal">(선택)</span></label><input id="profile-instagram" type="url" pattern="https://.*" value={instagram} onChange={(event) => setInstagram(event.target.value)} maxLength={500} placeholder="https://www.instagram.com/" className={providerInput} /></div>
        </fieldset>
        <Button type="submit" variant="primary" loading={busy === "save"} disabled={!canEdit || busy !== null}>소개글·링크 저장</Button>
      </form>
      <div className="mt-6 border-t border-[var(--hb-hairline)] pt-5">
        <h3 className="text-sm font-semibold text-[var(--hb-text-strong)]">프로필 공개</h3>
        <p className="mb-4 mt-2 text-sm leading-7">{profile.publication_status === "published" ? "현재 소개글과 사진이 공개되어 있어요. 공개를 중단하면 탐색 목록과 공개 상세에서 내려갑니다." : "등록 승인은 게시 권한을 부여합니다. 직접 공개하기를 눌러야 다른 사람이 소개글과 사진을 볼 수 있어요."}</p>
        {dirty && profile.publication_status !== "published" ? <p id="profile-publish-save-first" className="mb-3 text-sm leading-6">먼저 소개글·링크를 저장한 뒤 공개해 주세요. 저장하지 않은 내용은 게시되지 않습니다.</p> : null}
        <Button onClick={() => void mutate(profile.publication_status === "published" ? "pause" : "publish")} variant="secondary" loading={busy === "publish" || busy === "pause"} aria-describedby={dirty && profile.publication_status !== "published" ? "profile-publish-save-first" : undefined} disabled={!canEdit || busy !== null || (profile.publication_status !== "published" && dirty)}>{profile.publication_status === "published" ? "프로필 공개 중단" : "프로필 공개하기"}</Button>
      </div>
      {error ? <p role="alert" className="mt-4 rounded-md border border-rose-700/30 p-3 text-sm text-rose-700">{error}</p> : null}
    </section>
  );
}
