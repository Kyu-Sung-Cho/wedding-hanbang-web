"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";

/**
 * 운영자 상담 문의 대기열(W4 파일럿). 커플이 승인한 편지만 온다. 운영자가 업체의 공식 문의 창구로 직접 보내고
 * 보냈다고 표시한 뒤, 받은 답장을 원문 그대로 붙여 넣고 정해진 칸을 고른다. 이 화면은 아무것도 자동으로 보내지 않는다.
 */

type QueuedItem = {
  dispatchId: string;
  coupleRef: string;
  recipientName: string;
  queuedAt: string;
  sourceUrl: string | null;
  letter: { body: string; signature: string; shares: { name: string | null; phone: string | null; budget: string | null } } | null;
};

type SentItem = {
  dispatchId: string;
  coupleRef: string;
  recipientName: string;
  sentAt: string | null;
  channelNote: string | null;
  closed: boolean;
  replies: { outcome: string; eventAt: string | null; recordedAt: string }[];
};

type Queue = {
  sendingEnabled: boolean;
  dailyCap: number;
  dailyCapMisconfigured: boolean;
  globalDailyCap: number;
  globalDailyCapMisconfigured: boolean;
  queued: QueuedItem[];
  sent: SentItem[];
};

const OUTCOMES = [
  { id: "confirmed_time", label: "상담 시간 확정" },
  { id: "proposed_time", label: "다른 시간 제안" },
  { id: "declined", label: "어렵다는 답" },
  { id: "question", label: "업체 질문" },
  { id: "conditions_note", label: "가격·조건 안내" },
] as const;

const FIELD = "w-full rounded-[6px] border border-[var(--hb-hairline)] px-3 py-2 text-sm";

function when(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

function ReplyForm({ dispatchId, onSaved }: { dispatchId: string; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<string>("confirmed_time");
  const [eventAt, setEventAt] = useState("");
  const [rawText, setRawText] = useState("");
  const [placeNote, setPlaceNote] = useState("");
  const [priceNote, setPriceNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsTime = outcome === "confirmed_time" || outcome === "proposed_time";

  async function save() {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/invitation/admin/inquiries/${dispatchId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rawText,
        outcome,
        // 운영자는 한국 시간으로 적는다.
        eventAt: needsTime && eventAt ? `${eventAt}:00+09:00` : null,
        placeNote: placeNote || null,
        priceNote: priceNote || null,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setError(response ? await readError(response, "답장을 적지 못했어요.") : "인터넷 연결을 확인해 주세요.");
      return;
    }
    setRawText("");
    setEventAt("");
    setPlaceNote("");
    setPriceNote("");
    onSaved();
  }

  return (
    <div className="flex flex-col gap-2 rounded-[6px] bg-[var(--hb-surface-hover)] p-3">
      <label className="flex flex-col gap-1 text-xs font-semibold">
        답장 종류
        <select className={FIELD} value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          {OUTCOMES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {needsTime ? (
        <label className="flex flex-col gap-1 text-xs font-semibold">
          상담 시각(한국 시간)
          <input className={FIELD} type="datetime-local" value={eventAt} onChange={(event) => setEventAt(event.target.value)} />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-semibold">
        장소 메모(예: 2층 상담실)
        <input className={FIELD} value={placeNote} onChange={(event) => setPlaceNote(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        가격·조건 메모
        <input className={FIELD} value={priceNote} onChange={(event) => setPriceNote(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        답장 원문(받은 그대로)
        <textarea className={`${FIELD} min-h-24`} value={rawText} onChange={(event) => setRawText(event.target.value)} />
      </label>
      <div>
        <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>답장 적기</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-[#9A3F1C]">{error}</p> : null}
    </div>
  );
}

export function InquiryQueueAdmin() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  // 응답을 받은 뒤에만 상태를 바꾸고, 화면을 떠났거나 더 새 요청이 있으면 버린다.
  useEffect(() => {
    let active = true;
    fetch("/api/invitation/admin/inquiries", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, "대기열을 불러오지 못했어요."));
        const body = (await response.json().catch(() => null)) as Queue | null;
        if (!active) return;
        setError(null);
        setQueue(body);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error && reason.message ? reason.message : "인터넷 연결을 확인해 주세요.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function markSent(dispatchId: string) {
    setBusyId(dispatchId);
    setError(null);
    const response = await fetch(`/api/invitation/admin/inquiries/${dispatchId}/sent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelNote: notes[dispatchId] || null }),
    }).catch(() => null);
    setBusyId(null);
    if (!response?.ok) {
      setError(response ? await readError(response, "보냈다고 표시하지 못했어요.") : "인터넷 연결을 확인해 주세요.");
      return;
    }
    reload();
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <Link href="/admin" className="text-sm text-[var(--hb-text-muted)]">관리자 홈</Link>
        <h1 className="text-xl font-bold">상담 문의 대기열</h1>
        <p className="text-sm leading-6 text-[var(--hb-text-body)]">
          커플이 승인한 편지만 여기에 와요. 업체의 공식 문의 창구로 직접 보낸 뒤 보냈다고 표시해요.
          편지와 알려줄 정보는 이 업무에만 쓰고 다른 곳에 옮겨 적지 않아요.
        </p>
        {queue ? (
          <p className="text-sm font-semibold">
            문의 보내기 {queue.sendingEnabled ? "켜짐" : "꺼짐(새로 보내지 마세요)"} · 커플마다 하루 {queue.dailyCap}곳
            · 전체 하루 {queue.globalDailyCap}곳
            {queue.dailyCapMisconfigured || queue.globalDailyCapMisconfigured ? " · 상한 설정을 확인해 주세요" : ""}
          </p>
        ) : null}
      </header>
      {error ? <p role="alert" className="text-sm text-[#9A3F1C]">{error}</p> : null}
      {loading ? <p className="text-sm">불러오는 중이에요.</p> : null}

      {queue ? (
        <section className="flex flex-col gap-3" aria-label="보낼 편지">
          <h2 className="text-base font-semibold">보낼 편지 {queue.queued.length}통</h2>
          {queue.queued.length === 0 ? <p className="text-sm">보낼 편지가 없어요.</p> : null}
          {queue.queued.map((item) => (
            <article key={item.dispatchId} className="flex flex-col gap-2 rounded-[6px] border border-[var(--hb-hairline)] p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{item.recipientName}</strong>
                <span className="text-[var(--hb-text-muted)]">커플 {item.coupleRef} · {when(item.queuedAt)}</span>
              </div>
              {item.sourceUrl ? (
                <a className="break-all underline" href={item.sourceUrl} target="_blank" rel="noreferrer noopener">업체 공개 주소 {item.sourceUrl}</a>
              ) : null}
              {item.letter ? (
                <>
                  <p className="whitespace-pre-wrap leading-6">{item.letter.body}</p>
                  <p>{item.letter.signature}</p>
                  <ul className="text-[var(--hb-text-muted)]">
                    <li>이름: {item.letter.shares.name ?? "알려주지 않아요"}</li>
                    <li>휴대폰: {item.letter.shares.phone ?? "알려주지 않아요"}</li>
                    <li>예산: {item.letter.shares.budget ?? "알려주지 않아요"}</li>
                  </ul>
                </>
              ) : (
                <p className="text-[var(--hb-text-muted)]">문의 보내기가 꺼져 있어 편지 내용을 가렸어요. 켜진 뒤에 보내 주세요.</p>
              )}
              <label className="flex flex-col gap-1 text-xs font-semibold">
                보낸 창구 메모(예: 공식 홈페이지 문의 양식)
                <input
                  className={FIELD}
                  value={notes[item.dispatchId] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [item.dispatchId]: event.target.value }))}
                />
              </label>
              <div>
                <Button variant="primary" size="sm" loading={busyId === item.dispatchId} onClick={() => void markSent(item.dispatchId)}>
                  보냈어요
                </Button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {queue ? (
        <section className="flex flex-col gap-3" aria-label="보낸 편지와 답장">
          <h2 className="text-base font-semibold">보낸 편지(30일) {queue.sent.length}통</h2>
          {queue.sent.map((item) => (
            <article key={item.dispatchId} className="flex flex-col gap-2 rounded-[6px] border border-[var(--hb-hairline)] p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{item.recipientName}</strong>
                <span className="text-[var(--hb-text-muted)]">커플 {item.coupleRef} · 보냄 {when(item.sentAt)}</span>
              </div>
              {item.channelNote ? <p className="text-[var(--hb-text-muted)]">창구: {item.channelNote}</p> : null}
              <ul className="text-[var(--hb-text-muted)]">
                {item.replies.map((reply) => (
                  <li key={`${reply.recordedAt}-${reply.outcome}`}>
                    {OUTCOMES.find((outcome) => outcome.id === reply.outcome)?.label ?? reply.outcome}
                    {reply.eventAt ? ` · ${when(reply.eventAt)}` : ""} · 적은 시각 {when(reply.recordedAt)}
                  </li>
                ))}
              </ul>
              {item.closed ? (
                <p className="text-[var(--hb-text-muted)]">커플 한 사람이 탈퇴해서 편지를 지운 문의예요. 답장을 더 적지 않아요.</p>
              ) : (
                <ReplyForm dispatchId={item.dispatchId} onSaved={reload} />
              )}
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
