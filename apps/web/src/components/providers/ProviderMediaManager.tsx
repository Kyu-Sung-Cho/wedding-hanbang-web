"use client";

import Image from "next/image";
import { useRef, useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import { providerMediaUrl, type ProviderMedia } from "@/lib/providers/contracts";
import { providerFailure, providerRequest } from "./providerClient";
import { providerFocus, providerInput, providerLabel } from "./ProviderShell";

type Props = { providerId: string; media: ProviderMedia[]; published: boolean; onChanged: (message: string) => Promise<void> };

export default function ProviderMediaManager({ providerId, media, published, onChanged }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0) { setError("5MB 이하의 JPG, PNG, WebP 사진을 선택해 주세요."); return; }
    if (!rights || !altText.trim()) { setError("사진 설명과 공개 권한 확인이 필요해요."); return; }
    inFlight.current = true; setBusy("upload"); setError("");
    try {
      const form = new FormData(); form.set("file", file); form.set("caption", caption.trim()); form.set("alt_text", altText.trim()); form.set("rights_confirmed", "true");
      await providerRequest(`/api/provider/profiles/${providerId}/media`, { method: "POST", body: form });
      await onChanged(published ? "사진을 저장했고 공개 프로필에 반영했어요." : "사진을 저장했어요. 프로필을 공개하면 다른 사람에게 보입니다.");
      setFile(null); setCaption(""); setAltText(""); setRights(false); if (fileInput.current) fileInput.current.value = "";
    } catch (cause) { setError(providerFailure(cause)); }
    finally { inFlight.current = false; setBusy(null); }
  }

  async function remove(id: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(id); setError("");
    try { await providerRequest(`/api/provider/profiles/${providerId}/media/${id}`, { method: "DELETE" }); await onChanged("사진을 프로필에서 삭제했어요."); }
    catch (cause) { setError(providerFailure(cause)); }
    finally { inFlight.current = false; setBusy(null); }
  }

  return <section aria-labelledby="provider-media-heading" className="border-t border-[var(--hb-hairline)] pt-7">
    <h2 id="provider-media-heading" className="text-lg font-semibold text-[var(--hb-text-strong)]">작업 사진 <span className="text-sm font-normal tabular-nums">{media.length}/12</span></h2>
    <p className="mt-2 text-sm leading-7">이 서비스에 게시할 저작권상 권한과 사진 속 인물의 공개 동의를 확보한 사진만 올려주세요. 공개 중인 프로필에는 사진과 설명이 바로 반영되며 로그인하지 않은 사람도 볼 수 있습니다. 업로드 확인만으로 타인의 동의가 대신 처리되지는 않습니다.</p>
    {media.length ? <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">{media.map((item) => <figure key={item.id} className="min-w-0"><Image src={providerMediaUrl(providerId, item.id)} alt={item.alt_text} width={480} height={360} unoptimized className="aspect-[4/3] w-full rounded-md border border-[var(--hb-hairline)] object-cover" /><figcaption className="mt-2 break-words text-xs leading-6">{item.caption || item.alt_text}</figcaption><Button size="sm" variant="ghost" onClick={() => void remove(item.id)} loading={busy === item.id} disabled={busy !== null}>사진 삭제</Button></figure>)}</div> : <p className="mt-5 border-y border-[var(--hb-hairline)] py-5 text-sm text-[var(--hb-text-muted)]">아직 등록한 사진이 없어요.</p>}
    {media.length < 12 ? <form onSubmit={upload} className="mt-6 space-y-4"><fieldset disabled={busy !== null} className="space-y-4 disabled:opacity-60">
      <div><label htmlFor="provider-media-file" className={providerLabel}>사진 선택</label><input ref={fileInput} id="provider-media-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }} required className={providerInput} /><p className="mt-2 text-xs text-[var(--hb-text-muted)]">JPG, PNG, WebP · 한 장당 5MB 이하</p></div>
      <div><label htmlFor="provider-media-alt" className={providerLabel}>사진 설명</label><input id="provider-media-alt" value={altText} onChange={(event) => setAltText(event.target.value)} maxLength={200} required className={providerInput} placeholder="사진의 장소·작업 내용을 설명해 주세요." /></div>
      <div><label htmlFor="provider-media-caption" className={providerLabel}>추가 소개 (선택)</label><input id="provider-media-caption" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} className={providerInput} /></div>
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} required className={`mt-1 ${providerFocus}`} /><span>이 사진과 설명을 웨딩한방에 게시할 권한을 보유하며, 인물이 식별된다면 해당 인물의 공개 동의를 확보했어요.</span></label>
      <p className="text-xs leading-6 text-[var(--hb-text-muted)]">사진, 사진 설명, 추가 소개와 권리 확인 시각을 프로필 관리·공개에 사용합니다. 사진 삭제나 공개 중단을 직접 할 수 있습니다. <a href="/privacy#provider-participation" target="_blank" rel="noopener noreferrer" className={`underline underline-offset-4 ${providerFocus}`}>보관·삭제 안내</a></p>
    </fieldset><Button type="submit" variant="primary" loading={busy === "upload"} disabled={!file || !rights || busy !== null}>사진 올리기</Button></form> : <p className="mt-4 text-sm">사진은 최대 12장까지 등록할 수 있어요. 기존 사진을 삭제한 뒤 추가해 주세요.</p>}
    {error ? <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p> : null}
  </section>;
}
