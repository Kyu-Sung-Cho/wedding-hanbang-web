"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { CRITERIA, NOTES, SCALE } from "@/constants/weddingCode36";
import { presentIndividual, validateSubmission, type ComparisonCopy } from "@/lib/weddingCode36";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { clearResult36, readResult36, storeResult36, type Result36 } from "../storage36";
import { wc36Primary, wc36Secondary } from "../WeddingCodeClient";
import { parseCouplePayload36, type CouplePayload36 } from "./parseReport36";

function rating(value: number | null) { return value === null ? "건너뜀" : `${value}점 · ${SCALE.find((s) => s.value === value)?.label ?? ""}`; }
function viewerText(text: string) {
  return text.replaceAll("A는", "나는").replaceAll("B는", "파트너는").replaceAll("A가", "내가").replaceAll("B가", "파트너가").replaceAll("A의", "나의").replaceAll("B의", "파트너의");
}
function CopyBody({ copy }: { copy: ComparisonCopy }) {
  return <div className="space-y-3 text-sm leading-7 text-[#5A4742]">
    <p>{viewerText(copy.summary)}</p>
    {copy.good_point && <p><span className="font-semibold text-[#3A2A27]">함께 활용할 점 · </span>{viewerText(copy.good_point)}</p>}
    {copy.caution && <p><span className="font-semibold text-[#3A2A27]">확인할 점 · </span>{viewerText(copy.caution)}</p>}
    {copy.conversation && <p className="rounded-lg bg-[#F8F4EA] p-4">{viewerText(copy.conversation)}</p>}
    {copy.action && <p className="text-xs text-[#6E5A54]">{viewerText(copy.action)}</p>}
  </div>;
}

export default function WeddingCode36ResultClient() {
  const [record, setRecord] = useState<Result36 | null | "loading">("loading");
  const [couple, setCouple] = useState<CouplePayload36 | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [forgetConfirm, setForgetConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allowCompare, setAllowCompare] = useState(false);
  const [shareName, setShareName] = useState(false);
  const [shareIds, setShareIds] = useState<string[]>([]);
  const latestRequest = useRef(0);
  const alive = useRef(true);
  const mutating = useRef(false);
  const sharingInFlight = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("rid");
    const value = id && !isUuid(id) ? null : readResult36(id);
    setRecord(value);
    if (value) {
      setAllowCompare(value.submission.allow_couple_comparison); setShareName(value.submission.share_alias);
      setShareIds(value.submission.share_item_ids);
    }
    return () => { alive.current = false; latestRequest.current += 1; };
  }, []);
  const source = record && record !== "loading" ? record : null;
  const result = useMemo(() => source ? presentIndividual(source.submission) : null, [source]);

  const refresh = useCallback(async () => {
    if (!source || sharingInFlight.current || mutating.current) return;
    const requestId = ++latestRequest.current;
    setChecking(true); setError(null);
    try {
      const response = await fetch(`/api/wedding-code/v36/couple-report?response_id=${encodeURIComponent(source.id)}`, {
        headers: { "x-wedding-code-access-token": source.accessToken }, cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body)) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : "커플 결과를 불러오지 못했어요.");
      if (!alive.current || requestId !== latestRequest.current) return;
      const parsed = parseCouplePayload36(body);
      if (!parsed) throw new Error("커플 결과 형식을 확인하지 못했어요.");
      setCouple(parsed);
    } catch (e) { if (alive.current && requestId === latestRequest.current) setError(e instanceof Error ? e.message : "네트워크 연결을 확인해 주세요."); }
    finally { if (alive.current && requestId === latestRequest.current) setChecking(false); }
  }, [source]);

  useEffect(() => { if (source) void refresh(); }, [source, refresh]);
  useEffect(() => {
    if (!source) return;
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    // 대기 결과와 공유 철회가 화면에 반영되도록 열린 탭에서만 다시 확인한다.
    const timer = window.setInterval(onFocus, 30_000);
    return () => { document.removeEventListener("visibilitychange", onFocus); window.clearInterval(timer); };
  }, [source, refresh]);

  async function createInvite() {
    if (!source || mutating.current) return;
    mutating.current = true;
    setPairBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/wedding-code/v36/pair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_id: source.id, access_token: source.accessToken }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || !isUuid(body.coupleToken) || !["waiting", "paired"].includes(String(body.pairingStatus))) {
        throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : "초대 링크를 만들지 못했어요.");
      }
      setRecord(storeResult36({ ...source, coupleToken: body.coupleToken, pairingStatus: body.pairingStatus as "waiting" | "paired", pairingError: undefined }));
      setInvite(`${window.location.origin}/wedding-code?ct=${body.coupleToken}`);
      setMessage(body.pairingStatus === "paired" ? "이미 두 결과가 연결돼 있어요. 아래에서 비교 결과를 확인해 주세요." : "링크를 파트너에게 보내 주세요. 파트너가 답하면 비교 결과가 여기에 표시돼요.");
    } catch (e) { setError(e instanceof Error ? e.message : "초대를 만들지 못했어요."); }
    finally { mutating.current = false; setPairBusy(false); }
  }
  async function copyInvite() {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite); setMessage("초대 링크를 복사했어요."); }
    catch { linkInput.current?.select(); setMessage("링크가 선택됐어요. 복사해서 파트너에게 보내 주세요."); }
  }
  function toggleIds(ids: string[], checked: boolean) {
    setShareIds((old) => checked ? [...new Set([...old, ...ids])] : old.filter((id) => !ids.includes(id)));
  }
  async function saveSharing() {
    if (!source || mutating.current) return;
    mutating.current = true; sharingInFlight.current = true;
    setSaving(true); setError(null); setMessage(null);
    latestRequest.current += 1; setChecking(false); setCouple(null);
    try {
      const response = await fetch("/api/wedding-code/v36/response", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_id: source.id, access_token: source.accessToken,
          allow_couple_comparison: allowCompare, share_alias: shareName, share_item_ids: shareIds }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || body.success !== true) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : "공유 설정을 저장하지 못했어요.");
      const canonical = validateSubmission(body.submission);
      setRecord(storeResult36({ ...source, submission: canonical, expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : source.expiresAt }));
      setMessage("공유 설정을 저장했어요. 다음 조회부터 새 설정으로 비교해요.");
    } catch (e) { setError(e instanceof Error ? e.message : "공유 설정을 저장하지 못했어요. 다시 저장해 주세요."); }
    finally { mutating.current = false; sharingInFlight.current = false; setSaving(false); }
  }

  async function deleteResult() {
    if (!source || mutating.current) return;
    mutating.current = true; setDeleting(true); setError(null);
    latestRequest.current += 1; setCouple(null); setChecking(false);
    try {
      const response = await fetch("/api/wedding-code/v36/response", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_id: source.id, access_token: source.accessToken }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || body.deleted !== true) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : "삭제하지 못했어요. 다시 확인해 주세요.");
      clearResult36(source.id); setRecord(null); setInvite(null); setCouple(null);
      window.location.replace("/wedding-code?deleted=1");
    } catch (e) { setError(e instanceof Error ? e.message : "삭제하지 못했어요."); }
    finally { mutating.current = false; setDeleting(false); }
  }

  if (record === "loading") return <p className="p-8 text-sm" role="status">내 결과를 불러오고 있어요.</p>;
  if (!source || !result) return <main className="min-h-screen bg-[#FDFCF7] px-5 py-16 text-[#3A2A27]"><div className="mx-auto max-w-xl space-y-6"><h1 className="text-2xl font-semibold">이 브라우저에 결과가 없어요</h1><p className="text-sm leading-7">테스트한 브라우저에서 결과를 열어 주세요. 결과 주소만으로는 내 답이나 커플 비교를 볼 수 없어요.</p><Link href="/wedding-code" className={wc36Primary}>36문항 테스트하기</Link></div></main>;

  return <main className="min-h-screen bg-[#FDFCF7] px-5 py-8 text-[#3A2A27] sm:py-12"><div className="mx-auto max-w-2xl">
    <p className="text-xs font-semibold tracking-[0.15em] text-[#8F6662]">WEDDING CODE</p>
    <header className="mt-6 border-b border-[#E2DED2] pb-8">
      <h1 className="text-3xl font-semibold leading-tight sm:text-4xl" data-testid="wc36-result-name">{result.name}</h1>
      <p className="mt-5 text-base leading-8 text-[#5A4742]">{result.summary}</p>
      {result.why_this_name.map((text) => <p key={text} className="mt-3 text-xs leading-6 text-[#6E5A54]">{text}</p>)}
      <p className="mt-4 text-xs text-[#6E5A54]">답한 문항 {result.answered_count} / 36 · 지금의 결혼 준비 답변을 정리했어요.</p>
    </header>
    {source.storage !== "local" && <p role="status" className="mt-5 rounded-lg bg-[#F3E7DB] p-4 text-sm leading-7">이 브라우저는 결과를 오래 보관하지 못할 수 있어요. 현재 탭을 닫거나 새로고침하면 접근 권한이 사라질 수 있어요.</p>}
    <section className="space-y-6 py-8" aria-label="개인 결과 해석">
      {[["함께 활용할 점", result.good_points], ["확인할 점", result.cautions], ["이야기해 볼 질문", result.conversation]].map(([heading, texts]) =>
        <div key={heading as string}><h2 className="mb-3 text-base font-semibold">{heading as string}</h2><div className="space-y-2 text-sm leading-7 text-[#5A4742]">{(texts as string[]).map((text) => <p key={text}>{text}</p>)}</div></div>)}
    </section>
    <section className="border-t border-[#E2DED2] py-7" aria-labelledby="profile-heading"><h2 id="profile-heading" className="text-lg font-semibold">내 준비 기준 자세히 보기</h2>
      <p className="mt-2 text-xs leading-6 text-[#6E5A54]">평균은 세 장면의 동의 정도예요. 중요도 순위나 능력 점수가 아니에요.</p>
      <div className="mt-4 divide-y divide-[#E2DED2]">{result.profile.map((card) => <details key={card.id} className="py-4"><summary className="cursor-pointer text-sm font-semibold leading-7">{card.label}<span className="ml-3 text-xs font-normal text-[#6E5A54]">{card.mean === null ? "빈 답이 있어 평균 보류" : `응답 평균 ${card.mean.toFixed(1)} / 5`}</span></summary>
        <p className="mt-3 text-sm leading-7 text-[#5A4742]">{card.summary}</p><ol className="mt-4 space-y-5">{card.evidence.map((e) => <li key={e.id} className="border-l-2 border-[#DEC9BA] pl-4 text-sm leading-7"><p className="text-xs text-[#6E5A54]">{e.context}</p><p>{e.number}. {e.statement}</p><p className="mt-1 font-medium text-[#8F6662]">내 답 · {rating(e.value)}</p></li>)}</ol>
      </details>)}</div>
    </section>
    <section className="border-t border-[#E2DED2] py-7"><details><summary className="cursor-pointer text-lg font-semibold">장면별 메모 9개</summary><p className="mt-3 text-xs leading-6 text-[#6E5A54]">대표 이름 계산에 넣지 않는 장면별 답이에요. 따로 선택하지 않으면 파트너에게 공유하지 않아요.</p><div className="mt-5 space-y-6">{result.notes.map((note) => <div key={note.id} className="text-sm leading-7"><h3 className="font-semibold">{note.label}</h3><p className="text-xs text-[#6E5A54]">{note.context}</p><p>{note.number}. {note.statement}</p><p className="text-[#8F6662]">내 답 · {rating(note.value)}</p></div>)}</div></details></section>

    <section className="border-t border-[#E2DED2] py-8" aria-labelledby="couple-heading">
      <h2 id="couple-heading" className="text-xl font-semibold">파트너와 준비 방식 비교</h2>
      <p className="mt-3 text-sm leading-7 text-[#5A4742]">서로 공유에 동의한 답을 나란히 보고, 먼저 이야기할 장면을 찾아봐요.</p>
      <div className="mt-5 flex flex-wrap gap-3"><Button type="button" variant="primary" size="lg" onClick={createInvite} disabled={pairBusy || saving} className={wc36Primary}>{pairBusy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{source.coupleToken ? "내 초대 링크 확인" : "파트너 초대 링크 만들기"}</Button><Button type="button" variant="secondary" size="md" onClick={() => void refresh()} disabled={checking || saving} className={wc36Secondary}><RefreshCw size={15} aria-hidden="true" />상태 다시 확인</Button></div>
      {invite && <div className="mt-4"><label htmlFor="invite-link-36" className="text-xs text-[#6E5A54]">파트너 초대 링크</label><div className="mt-2 flex gap-2"><input ref={linkInput} id="invite-link-36" readOnly value={invite} className="min-w-0 flex-1 rounded-lg border border-[#E2DED2] bg-white px-3 text-xs" /><Button type="button" variant="secondary" size="md" className={wc36Secondary} onClick={copyInvite}><Copy size={15} aria-hidden="true" />복사</Button></div><p className="mt-2 text-xs leading-6 text-[#6E5A54]">한 사람만 참여할 수 있는 링크예요. 링크만으로 결과를 읽을 수는 없어요.</p></div>}
      {couple?.status === "waiting" && <p role="status" className="mt-5 rounded-lg bg-[#F3E7DB] p-4 text-sm leading-7">파트너의 응답을 기다리고 있어요. 파트너가 완료하면 열린 화면에서 상태를 다시 확인해요.</p>}
      {source.pairingStatus === "full" && <p className="mt-4 text-sm leading-7">받은 초대에는 이미 두 결과가 연결돼 있어요. 내 개인 결과는 보관했어요. 다른 초대를 받거나 내 초대를 만들 수 있어요.</p>}
      {source.pairingError && <p className="mt-4 text-sm leading-7" role="status">받은 초대에 연결하지 못했지만 내 답과 결과는 보관했어요. 파트너에게 링크를 다시 받거나 내 초대 링크를 만들어 주세요.</p>}
      {couple?.status === "ready" && <div className="mt-7" data-testid="wc36-couple-result">
        {couple.report.names && <div className="mb-5 grid grid-cols-1 gap-3 rounded-lg bg-[#F3E7DB] p-5 sm:grid-cols-2"><div><p className="text-xs text-[#6E5A54]">나</p><h3 className="mt-1 text-lg font-semibold">{couple.report.names.a.name}</h3></div><div><p className="text-xs text-[#6E5A54]">파트너</p><h3 className="mt-1 text-lg font-semibold">{couple.report.names.b.name}</h3></div></div>}
        <p className="text-sm leading-7 text-[#5A4742]">{couple.report.summary}</p>
        {!couple.report.names && <p className="mt-2 text-xs leading-6 text-[#6E5A54]">이름은 두 사람 모두 공유할 때만 표시해요. 답변 비교는 별도의 공유 설정을 따라요.</p>}
        <div className="mt-6 space-y-7">{couple.report.body.core_cards.map((card) => <article key={card.criterion} className="border-t border-[#E2DED2] pt-6"><h3 className="mb-3 text-base font-semibold">{card.label}</h3><CopyBody copy={card.copy} />
          <details className="mt-4"><summary className="cursor-pointer text-xs text-[#6E5A54]">공유한 장면과 두 사람의 답 보기</summary><div className="mt-4 space-y-5">{card.evidence.map((e) => <div key={e.item_id} className="border-l-2 border-[#DEC9BA] pl-4 text-sm leading-7"><p className="text-xs text-[#6E5A54]">{e.context}</p><p>{e.display_number}. {e.statement}</p><p className="mt-1">내 답 · {rating(e.a)}<br />파트너 답 · {rating(e.b)}</p>{e.discussion_candidate && <p className="mt-1 text-xs text-[#8F6662]">동의 정도가 달라요. 이유를 이야기해 봐요.</p>}</div>)}</div></details>
        </article>)}</div>
        {couple.report.body.single_note_cards.length > 0 && <div className="mt-8 space-y-7"><h3 className="text-base font-semibold">서로 공유한 장면 메모</h3>{couple.report.body.single_note_cards.map((card) => <article key={card.id} className="border-t border-[#E2DED2] pt-5"><h4 className="mb-3 font-semibold">{card.label}</h4><p className="text-xs leading-6 text-[#6E5A54]">{card.evidence.context}</p><p className="my-3 text-sm leading-7">{card.evidence.statement}<br />내 답 · {rating(card.evidence.a)}<br />파트너 답 · {rating(card.evidence.b)}</p><CopyBody copy={card.copy} /></article>)}</div>}
      </div>}
      {checking && !couple && <p className="mt-4 text-sm" role="status">연결 상태를 확인하고 있어요.</p>}
      {error && <p className="mt-4 rounded-lg border border-[#D8B8B2] bg-[#FFF7F5] p-4 text-sm leading-7 text-[#7D4540]" role="alert">{error}</p>}
      {message && <p className="mt-4 text-sm leading-7 text-[#5A4742]" role="status">{message}</p>}
    </section>

    <section className="border-t border-[#E2DED2] py-7"><details><summary className="cursor-pointer text-base font-semibold">커플 공유 설정 바꾸기</summary>
      <fieldset disabled={saving || pairBusy} className="mt-5 space-y-4 text-sm leading-7"><legend className="sr-only">공유 범위</legend>
        <label className="flex items-start gap-3"><input type="checkbox" checked={allowCompare} onChange={(e) => setAllowCompare(e.target.checked)} className="mt-1.5 h-4 w-4 accent-[#8F6662]" />서로 공유한 답의 커플 비교 허용</label>
        <label className="flex items-start gap-3"><input type="checkbox" checked={shareName} onChange={(e) => setShareName(e.target.checked)} className="mt-1.5 h-4 w-4 accent-[#8F6662]" />내 결과 이름 공유</label>
        <p className="text-xs text-[#6E5A54]">이름에서 몇 가지 준비 선호를 유추할 수 있어요. 두 사람 모두 허용할 때만 보여줘요.</p>
        <p className="pt-2 font-semibold">준비 기준 · 각 기준의 세 장면</p>{CRITERIA.map((criterion) => <label key={criterion.id} className="flex items-center gap-3"><input type="checkbox" checked={criterion.item_ids.every((id) => shareIds.includes(id))} onChange={(e) => toggleIds(criterion.item_ids, e.target.checked)} className="h-4 w-4 accent-[#8F6662]" />{criterion.label}</label>)}
        <p className="pt-3 font-semibold">장면 메모 · 선택한 답만 공유</p>{NOTES.map((note) => <label key={note.id} className="flex items-center gap-3"><input type="checkbox" checked={shareIds.includes(note.id)} onChange={(e) => toggleIds([note.id], e.target.checked)} className="h-4 w-4 accent-[#8F6662]" />{note.label}</label>)}
        <Button type="button" variant="primary" size="lg" onClick={saveSharing} className={wc36Primary}>{saving ? "저장 중…" : "공유 설정 저장"}</Button>
      </fieldset>
    </details></section>
    <section className="border-t border-[#E2DED2] py-7"><h2 className="text-base font-semibold">내 결과 보관과 삭제</h2>
      <p className="mt-3 text-xs leading-6 text-[#6E5A54]">서버의 답은 저장 후 7일까지 조회하고, 그 뒤 하루 안에 삭제해요. 이 브라우저의 개인 결과는 직접 지울 때까지 남을 수 있어요. 삭제하면 내 답과 커플 연결을 지우며, 파트너가 따로 보관한 내용은 회수할 수 없어요.</p>
      {source.expiresAt && <p className="mt-2 text-xs text-[#6E5A54]">서버 조회 기한 · {new Date(source.expiresAt).toLocaleString("ko-KR")}</p>}
      {!deleteConfirm ? <Button type="button" variant="secondary" size="md" className={`${wc36Secondary} mt-4`} onClick={() => setDeleteConfirm(true)}>내 결과 삭제하기</Button> : <div className="mt-4 space-y-3"><p className="text-sm leading-7">내 답과 이 브라우저의 결과를 지우고 커플 연결을 끝낼까요? 삭제한 답은 되돌릴 수 없어요.</p><div className="flex gap-3"><Button type="button" variant="primary" size="lg" disabled={deleting || saving || pairBusy} className={wc36Primary} onClick={deleteResult}>{deleting ? "삭제 중…" : "삭제하고 연결 끝내기"}</Button><Button type="button" variant="secondary" size="md" disabled={deleting} className={wc36Secondary} onClick={() => setDeleteConfirm(false)}>취소</Button></div></div>}
      <details className="mt-5"><summary className="cursor-pointer text-xs text-[#6E5A54]">서버 결과 기한이 끝났거나 브라우저 사본만 지우려면</summary><p className="mt-3 text-xs leading-6 text-[#6E5A54]">이 동작은 이 브라우저의 내 결과와 접근 권한만 지워요. 서버 결과는 지우지 않으므로 먼저 위의 결과 삭제를 이용해 주세요. 접근 권한을 지우면 서버 결과는 원래 기한까지 남고 다시 열 수 없을 수 있어요.</p>{!forgetConfirm ? <Button type="button" variant="secondary" size="md" className={`${wc36Secondary} mt-3`} onClick={() => setForgetConfirm(true)}>이 브라우저 사본만 지우기</Button> : <div className="mt-3 flex flex-wrap gap-3"><Button type="button" variant="secondary" size="md" disabled={deleting || saving || pairBusy} className={wc36Secondary} onClick={() => { clearResult36(source.id); latestRequest.current += 1; setCouple(null); setInvite(null); setRecord(null); }}>브라우저 사본과 접근 권한 지우기</Button><Button type="button" variant="secondary" size="md" className={wc36Secondary} onClick={() => setForgetConfirm(false)}>취소</Button></div>}</details>
    </section>
    <footer className="border-t border-[#E2DED2] py-7"><p className="mb-5 text-xs leading-6 text-[#6E5A54]">이 결과는 지금 답한 결혼 준비 장면을 정리한 참고 자료예요. 성격 진단이나 관계 예측이 아니며, 실제 이용자를 통한 측정 타당성 검증은 아직 진행 전이에요.</p><Link href="/wedding-code" className={wc36Secondary}>테스트 처음부터 보기</Link></footer>
  </div></main>;
}
