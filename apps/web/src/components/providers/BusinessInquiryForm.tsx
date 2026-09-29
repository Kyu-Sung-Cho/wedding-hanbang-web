"use client";

import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import Button from "@/components/ui/Button";
import { providerFailure, providerJson, providerRequest } from "./providerClient";
import { providerFocus, providerInput, providerLabel } from "./ProviderShell";

const inquiryResultSchema = z.object({ inquiry_id: z.string().uuid(), status: z.string() });
const inquiryKinds = [{ value: "collaboration", label: "협업·제휴 제안" }, { value: "media", label: "취재·미디어 문의" }, { value: "data", label: "자료·데이터 협업" }, { value: "other", label: "기타 비즈니스 문의" }];

export default function BusinessInquiryForm() {
  const [kind, setKind] = useState("collaboration");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [contactName, setContactName] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !privacy) return;
    const input = { kind, subject: subject.trim(), message: message.trim(), contact_name: contactName.trim(), privacy_consent: true };
    if (!input.subject || !input.message || !input.contact_name) { setError("제목, 문의 내용과 담당자 이름을 입력해 주세요."); return; }
    const payload = JSON.stringify(input);
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await providerRequest("/api/business/inquiries", providerJson("POST", { ...input, request_id: request.current.id }));
      if (!inquiryResultSchema.safeParse(response).success) throw new Error("INVALID_INQUIRY_RESULT");
      setDone(true);
    } catch (cause) { setError(providerFailure(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (done) return <section role="status" className="max-w-2xl rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-6"><h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">비즈니스 문의가 접수됐어요</h2><p className="mt-3 text-sm leading-7">제공자 센터에서 접수 내용과 운영팀의 답변을 확인할 수 있어요. 문의가 공개 프로필로 등록되지는 않습니다.</p><Button href="/provider" variant="primary" className="mt-5">내 문의 확인하기</Button></section>;

  return <form onSubmit={submit} className="max-w-2xl space-y-6"><fieldset disabled={busy} className="space-y-6 disabled:opacity-70">
    <div><label className={providerLabel} htmlFor="inquiry-kind">문의 종류</label><select id="inquiry-kind" value={kind} onChange={(event) => setKind(event.target.value)} className={providerInput}>{inquiryKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
    <div><label className={providerLabel} htmlFor="inquiry-subject">제목</label><input id="inquiry-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} required className={providerInput} /></div>
    <div><label className={providerLabel} htmlFor="inquiry-contact">담당자 이름</label><input id="inquiry-contact" value={contactName} onChange={(event) => setContactName(event.target.value)} maxLength={80} required className={providerInput} /><p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">회신에는 확인된 계정 이메일을 사용하며, 답변은 제공자 센터에서 확인할 수 있습니다.</p></div>
    <div><label className={providerLabel} htmlFor="inquiry-message">문의 내용</label><textarea id="inquiry-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} rows={7} required className={providerInput} placeholder="함께 하고 싶은 일과 소개 링크가 있으면 알려주세요." /><p className="mt-2 text-xs text-[var(--hb-text-muted)]">고객 명단·신분증·계좌번호 등 개인정보는 첨부하지 마세요.</p></div>
    <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} required className={`mt-1 shrink-0 ${providerFocus}`} /><span>문의 처리를 위한 담당자 이름, 계정 이메일과 문의 내용 수집·이용에 동의합니다. (필수)</span></label>
    <div className="space-y-2 rounded-md bg-[var(--hb-surface-hover)] p-4 text-xs leading-6"><p>목적: 비즈니스 문의 처리, 답변 제공과 문의 내역 확인.</p><p>항목: 계정 식별자와 확인된 이메일, 담당자 이름, 문의 종류·제목·내용, 동의 시각, 처리 상태와 답변.</p><p>보유: 문의·답변 내역 제공을 위해 계정 유지 중 보관하며, 처리 목적이 끝나거나 삭제 요청·탈퇴가 처리되면 더 이상 필요하지 않은 개인정보를 파기합니다.</p><p>동의를 거부할 수 있으며, 거부하면 문의를 접수할 수 없습니다. 삭제·처리정지 요청 창구와 절차는 <a href="/privacy#provider-participation" target="_blank" rel="noopener noreferrer" className={`underline underline-offset-4 ${providerFocus}`}>개인정보 처리방침</a>에서 확인해 주세요.</p></div>
  </fieldset>{error ? <p role="alert" className="rounded-md border border-rose-700/30 bg-rose-pale/30 p-3 text-sm text-rose-700">{error}</p> : null}<Button type="submit" variant="primary" loading={busy} disabled={!privacy}>비즈니스 문의 보내기</Button></form>;
}
