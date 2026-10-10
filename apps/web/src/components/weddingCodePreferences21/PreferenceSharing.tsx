"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { ITEMS21, responseLabel } from "@/lib/weddingCode/preferences21/bank";
import { buildPreferences21FriendCard, createPreferences21ReturnFragment, createPreferences21ShareFragment, type Preferences21PartnerInvitation } from "@/lib/weddingCode/preferences21/share";
import { buildPreferences21AmoraDraft } from "@/lib/weddingCode/preferences21/amora";
import type { Answers, ItemId } from "@/lib/weddingCode/preferences21/types";
import { ACTION, FOCUS, PANEL, TEXT } from "./styles";

export default function PreferenceSharing({ answers, invitation }: { answers: Answers; invitation: Preferences21PartnerInvitation | null }) {
  const [mode, setMode] = useState<"summary" | "invite" | "return">("summary");
  const [consent, setConsent] = useState(false);
  const [scopeConsent, setScopeConsent] = useState(false);
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<ItemId[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const card = buildPreferences21FriendCard(answers);
  const switchMode = (next: typeof mode) => { setMode(next); setConsent(false); setScopeConsent(false); setLink(""); setNotice(""); };
  const generate = () => {
    if (!consent || (mode !== "summary" && !scopeConsent)) return;
    const fragment = mode === "return" && invitation
      ? createPreferences21ReturnFragment(invitation, answers, { consent: true })
      : createPreferences21ShareFragment(mode === "summary" ? { kind: "summary", answers } : { kind: "partner-invitation", answers, consent: true });
    if (!fragment) { setNotice("링크를 만들지 못했어요. 초대가 만료됐거나 답의 형식을 확인해야 해요."); return; }
    setLink(`${window.location.origin}/wedding-code/preferences21${fragment}`);
    setNotice("링크를 만들었어요. 아래 주소를 복사해서 직접 보내 주세요. 누구에게도 자동으로 전송하지 않았어요.");
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice("복사했어요. 보낼 곳을 확인한 뒤 직접 붙여 넣어 주세요."); }
    catch { setNotice("자동 복사가 되지 않았어요. 아래 내용을 선택해서 직접 복사해 주세요."); }
  };
  return <div className="space-y-6">
    <section className={PANEL} aria-labelledby="p21-share-title">
      <h2 id="p21-share-title" className="text-xl font-semibold">보여줄 내용을 고르고 공유해요</h2>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="공유 방식">
        <Button aria-pressed={mode === "summary"} className={ACTION} onClick={() => switchMode("summary")}>친구에게 요약</Button>
        <Button aria-pressed={mode === "invite"} className={ACTION} onClick={() => switchMode("invite")}>파트너 초대</Button>
        {invitation && <Button aria-pressed={mode === "return"} className={ACTION} onClick={() => switchMode("return")}>내 답을 돌려 보내기</Button>}
      </div>
      <div className="mt-4 rounded-xl border border-[var(--hb-hairline)] p-4">
        <h3 className="font-semibold">{mode === "summary" ? "친구가 보게 될 요약" : mode === "return" ? "비교 링크에 담길 두 사람의 답" : "초대 링크에 담길 내 답"}</h3>
        {mode === "summary" ? <div className={`mt-2 ${TEXT}`}>
          <p>{card?.summary}</p>
          <ul className="mt-2 list-disc space-y-2 pl-5">{card?.lines.map((line) => <li key={line.itemId}>{line.text}</li>)}</ul>
          <p className="mt-3">가족 문항·1–5 원답·상대의 답은 이 요약에 넣지 않아요.</p>
        </div> : <>
          <p className={`mt-2 ${TEXT}`}>문항별 원답을 포함해요. 가족 문항도 들어가므로, 펼쳐서 공개될 내용을 확인해 주세요.</p>
          <details className="mt-3"><summary className={`min-h-12 cursor-pointer rounded py-3 ${FOCUS}`}>21문항 공개 내용 확인</summary>
            <ul className={`space-y-3 ${TEXT}`}>{ITEMS21.map((item) => <li key={item.id}><strong>{item.number}. {item.statement}</strong><br />내 답: {responseLabel(answers[item.id])}{mode === "return" && invitation && <><br />초대자 답: {responseLabel(invitation.answers[item.id])}</>}</li>)}</ul>
          </details>
        </>}
      </div>
      <p className={`mt-4 ${TEXT}`}>{mode === "summary" ? "이 링크는 만든 시점부터 30일 동안 열 수 있어요." : mode === "return" ? "돌려 보내는 링크도 최초 초대의 만료 시각까지만 열 수 있어요." : "파트너는 링크를 열고 로그인 없이 같은 21문항에 답해요. 내 원답과 나란히 비교한 뒤, 본인 원답 공개에 동의하면 비교 링크를 돌려 보낼 수 있어요. 초대는 30일 뒤 만료돼요."}</p>
      <p className={`mt-2 ${TEXT}`}>주소를 가진 사람은 공유 내용을 읽고 다시 보낼 수 있어요. 암호화된 비밀 링크가 아니며, 이미 보낸 링크의 답 수정이나 즉시 회수는 지원하지 않아요. 앱은 만료 뒤 내용을 열지 않지만, 복사된 내용 자체를 삭제할 수는 없어요.</p>
      <label className={`mt-4 flex min-h-12 items-start gap-3 ${TEXT}`}><input className={`mt-2 size-5 shrink-0 ${FOCUS}`} type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); setLink(""); }} />위 미리보기 내용을 이 링크로 공개하는 데 동의해요.</label>
      {mode !== "summary" && <label className={`flex min-h-12 items-start gap-3 ${TEXT}`}><input className={`mt-2 size-5 shrink-0 ${FOCUS}`} type="checkbox" checked={scopeConsent} onChange={(event) => { setScopeConsent(event.target.checked); setLink(""); }} />원답과 가족 응답도 공개되며, 링크를 전달받은 사람도 읽을 수 있음을 확인했어요.</label>}
      <Button variant="primary" className={`mt-3 ${ACTION}`} disabled={Boolean(link) || !consent || (mode !== "summary" && !scopeConsent)} onClick={generate}>{mode === "summary" ? "요약 링크 만들기" : mode === "return" ? "비교 링크 만들기" : "초대 링크 만들기"}</Button>
      {link && <div className="mt-4 space-y-3"><label className={`block ${TEXT}`} htmlFor="p21-share-url">보낼 주소</label><textarea id="p21-share-url" aria-label="보낼 주소" readOnly rows={4} value={link} className={`w-full rounded-xl border border-[var(--hb-hairline)] p-3 text-xs [overflow-wrap:anywhere] ${FOCUS}`} /><Button className={ACTION} onClick={() => void copy(link)}>링크 복사</Button></div>}
      <p role="status" className={`mt-3 ${TEXT}`}>{notice}</p>
    </section>
    <section className={PANEL}>
      <h2 className="text-xl font-semibold">아모라와 이어서 이야기할 메모</h2>
      <p className={`mt-2 ${TEXT}`}>내가 고른 본인 응답만 최대 5개 담아요. 가족 문항은 제외하고, 상대의 답은 전달하지 않아요.</p>
      <details className="mt-3"><summary className={`min-h-12 cursor-pointer py-3 ${FOCUS}`}>메모에 담을 문항 선택 · {selected.length}/5</summary>
        <div className="space-y-3">{ITEMS21.filter((item) => item.topicId !== "C" && typeof answers[item.id] === "number").map((item) => <label key={item.id} className={`flex min-h-12 gap-3 ${TEXT}`}><input type="checkbox" className={`mt-2 size-5 shrink-0 ${FOCUS}`} checked={selected.includes(item.id)} disabled={selected.length >= 5 && !selected.includes(item.id)} onChange={(event) => { setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id)); setDraft(null); }} /><span>{item.number}. {item.statement}<br />내 답: {responseLabel(answers[item.id])}</span></label>)}</div>
      </details>
      <Button className={`mt-3 ${ACTION}`} disabled={selected.length === 0} onClick={() => setDraft(buildPreferences21AmoraDraft(answers, selected)?.text ?? null)}>편집할 메모 만들기</Button>
      {draft !== null && <div className="mt-4 space-y-3"><label className={`block ${TEXT}`} htmlFor="p21-amora-draft">아직 보내지 않은 메모 · 자유롭게 고쳐 주세요</label><textarea id="p21-amora-draft" rows={12} value={draft} onChange={(event) => setDraft(event.target.value)} className={`w-full rounded-xl border border-[var(--hb-hairline)] p-3 ${TEXT} ${FOCUS}`} /><div className="flex flex-wrap gap-2"><Button disabled={!draft.trim()} className={ACTION} onClick={() => void copy(draft)}>메모 복사</Button><Button href="/chat" className={ACTION}>아모라 대화 열기</Button></div><p className={TEXT}>본인이 대화에 붙여 넣고 보내면 해당 대화의 처리·저장 기준이 적용돼요. 이 화면에서는 보내거나 예산·일정·할 일·결정 기록을 변경하지 않아요.</p></div>}
    </section>
  </div>;
}
