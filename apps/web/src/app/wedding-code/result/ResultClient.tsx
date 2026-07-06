"use client";

// 웨딩코드 미러 프로필 v0 — "나 × 시장 리포트" (지시서 §2).
// 채점·유형·판정 없음: 본인이 고른 문장(주인공) + A급 시장 팩트(모두 동일 문장·동일 톤).
// 상태: 제출 직후 sessionStorage(wc_result_v04) 백업을 읽는다. 없으면 폼으로 안내.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Check, ChevronDown, ChevronUp, ClipboardCheck, Copy, Download, Heart, Loader2,
} from "lucide-react";
import { WC_QUESTIONS } from "@/constants/weddingCodeForm";
import {
  WC_RESULT_TITLE, WC_RESULT_SUBTITLE, WC_RESULT_PROTO_NOTICE,
  WC_FACTS, WC_CARD_DEFS, WC_QUOTE_TEXTS, WC_SCENARIO_SUMMARIES,
  pickTalkCard, WC_CARD_BRAND,
} from "@/constants/weddingCodeResult";
import { renderShareCard, downloadCanvasPng } from "@/lib/weddingCode/shareCard";
import { captureEvent } from "@/lib/analytics";

export interface WcResultBackup {
  answers: Record<string, string>;
  skipped: Record<string, boolean>;
  responseId: string | null;
  paired: boolean;
  coupleToken: string | null; // 생성자가 만든 토큰 (새로고침 유지)
  savedAt: string;
}

export const WC_RESULT_STORAGE_KEY = "wc_result_v04";

const card = "rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_10px_30px_rgba(8,22,38,0.05)]";
const primaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642] disabled:opacity-40";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#eadfc9] bg-white px-5 text-[13px] font-semibold text-[#6d625a] transition-colors hover:bg-[#f7f3ec]";

function readBackup(): WcResultBackup | null {
  try {
    const raw = window.sessionStorage.getItem(WC_RESULT_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as WcResultBackup;
    return value && typeof value === "object" && value.answers ? value : null;
  } catch {
    return null;
  }
}

function writeBackup(backup: WcResultBackup): void {
  try {
    window.sessionStorage.setItem(WC_RESULT_STORAGE_KEY, JSON.stringify(backup));
  } catch {
    /* storage 불가 환경 무시 */
  }
}

export default function WeddingCodeResultClient() {
  const [backup, setBackup] = useState<WcResultBackup | null | "loading">("loading");
  const [savingCard, setSavingCard] = useState<number | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [inviteState, setInviteState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    const data = readBackup();
    setBackup(data);
    if (data) captureEvent("wc_result_viewed", { paired: data.paired });
  }, []);

  // 카드 3장 해석 (§2-B 고정 배정 + q13 건너뜀 폴백)
  const cards = useMemo(() => {
    if (!backup || backup === "loading") return [];
    return WC_CARD_DEFS.map((def) => {
      let qKey = def.questionKey;
      let factId: string | null = def.factId;
      if (!backup.answers[qKey] && def.fallback) {
        qKey = def.fallback.questionKey;
        factId = def.fallback.factId;
      }
      const answer = backup.answers[qKey];
      if (!answer) return null;
      const quote = WC_QUOTE_TEXTS[qKey]?.[answer];
      if (!quote) return null;
      const fact = factId ? WC_FACTS[factId] : null;
      return {
        cardId: def.cardId,
        scenario: WC_SCENARIO_SUMMARIES[qKey] ?? "",
        quote,
        factText: fact?.text ?? null,
        factSource: fact?.source ?? null,
      };
    }).filter((c): c is NonNullable<typeof c> => c !== null);
  }, [backup]);

  async function saveCard(cardId: number, scenario: string, quote: string, factText: string | null, factSource: string | null) {
    setSavingCard(cardId);
    try {
      const canvas = await renderShareCard({
        scenario, quote, factText, factSource, brand: WC_CARD_BRAND,
      });
      downloadCanvasPng(canvas, `weddingcode-card-${cardId}.png`);
      captureEvent("wc_result_card_saved", { card_id: cardId });
    } catch {
      /* 렌더 실패는 조용히 — 다음 탭에서 재시도 가능 */
    } finally {
      setSavingCard(null);
    }
  }

  async function createInvite() {
    if (!backup || backup === "loading" || !backup.responseId || inviteState === "creating") return;
    // 이미 만든 토큰이 있으면 재사용 (새로고침·재클릭 안전)
    let token = backup.coupleToken;
    setInviteState("creating");
    try {
      if (!token) {
        token = crypto.randomUUID();
        const res = await fetch("/api/wedding-code/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response_id: backup.responseId, couple_token: token }),
        });
        if (!res.ok) {
          setInviteState("error");
          return;
        }
        const next = { ...backup, coupleToken: token };
        setBackup(next);
        writeBackup(next);
        captureEvent("wc_invite_link_created", {});
      }
      const link = `${window.location.origin}/wedding-code?ct=${token}`;
      setInviteLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setInviteState("copied");
      } catch {
        setInviteState("idle"); // 클립보드 실패해도 링크는 화면에 표시
      }
    } catch {
      setInviteState("error");
    }
  }

  if (backup === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2]">
        <Loader2 className="h-6 w-6 animate-spin text-[#9d6f36]" />
      </div>
    );
  }

  // 백업 없음 (직접 URL 진입·세션 만료) → 폼으로 안내
  if (!backup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] px-4">
        <div className={`${card} max-w-[420px] p-8 text-center`}>
          <p className="font-serif-kr text-[20px] font-medium text-[#263832]">
            결과를 불러올 응답이 없어요
          </p>
          <p className="mt-2 text-[13px] font-medium leading-relaxed text-[#5d6879]">
            테스트를 먼저 완료하면 이 화면에서 선택을 되돌아볼 수 있어요.
          </p>
          <Link href="/wedding-code" className={`${primaryBtn} mt-5 w-full`}>
            테스트 하러 가기 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  const talkText = pickTalkCard(backup.answers);

  return (
    <div className="min-h-screen bg-[#fbf8f2] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[560px]">
        {/* 프로토타입 고지 (§1-6) */}
        <p className="mb-4 text-center text-[12px] font-semibold text-[#9d6f36]">
          {WC_RESULT_PROTO_NOTICE}
        </p>

        {/* 섹션 A — 헤더 */}
        <h1 className="text-center font-serif-kr text-[27px] font-medium leading-[1.3] text-[#263832] sm:text-[31px]">
          {WC_RESULT_TITLE}
        </h1>
        <p className="mt-2 text-center text-[13px] font-medium leading-relaxed text-[#5d6879]">
          {WC_RESULT_SUBTITLE}
        </p>

        {/* 페어 완성 배너 (파트너 측, §6) */}
        {backup.paired && (
          <div className="mt-5 flex items-center gap-2.5 rounded-[14px] border border-[#36534E]/25 bg-[#EEF4F1] px-4 py-3.5">
            <Heart className="h-4 w-4 shrink-0 text-[#36534E]" />
            <p className="text-[13px] font-semibold leading-relaxed text-[#36534E]">
              두 분의 응답이 연결됐어요. 비교 리포트는 준비 중 — 이 링크로 다시 확인할 수 있어요.
            </p>
          </div>
        )}

        {/* 섹션 B — 인용 카드 3장 (주인공) */}
        <div className="mt-7 flex flex-col gap-5">
          {cards.map((c) => (
            <article key={c.cardId} className={`${card} overflow-hidden`}>
              <div className="px-6 pb-6 pt-6 sm:px-8 sm:pt-7">
                <p className="text-[12px] font-semibold tracking-wide text-[#9d6f36]">{c.scenario}</p>
                <p className="mt-3 font-serif-kr text-[24px] font-semibold leading-[1.45] text-[#263832] sm:text-[27px]">
                  <span aria-hidden className="mr-1 text-[#9d6f36]">“</span>
                  {c.quote}
                  <span aria-hidden className="ml-1 text-[#9d6f36]">”</span>
                </p>
                {c.factText && (
                  <div className="mt-5 border-t border-[#eadfc9] pt-4">
                    <p className="text-[11px] font-semibold tracking-wide text-[#9d6f36]">함께 보는 시장 숫자</p>
                    <p className="mt-1.5 text-[13px] font-medium leading-[1.7] text-[#34445a]">{c.factText}</p>
                    <p className="mt-1 text-[11px] font-medium text-[#9a9188]">출처: {c.factSource}</p>
                  </div>
                )}
              </div>
              <div className="border-t border-[#eadfc9] bg-[#fffdf7] px-6 py-3 sm:px-8">
                <button
                  onClick={() => saveCard(c.cardId, c.scenario, c.quote, c.factText, c.factSource)}
                  disabled={savingCard === c.cardId}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#36534E] transition-colors hover:text-[#2d4642] disabled:opacity-50"
                >
                  {savingCard === c.cardId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  이미지로 저장
                </button>
              </div>
            </article>
          ))}
        </div>

        {/* 섹션 E — CTA 2개 */}
        <div className="mt-7 flex flex-col gap-2.5">
          {!backup.paired && backup.responseId && (
            <div className={`${card} p-5`}>
              <button onClick={createInvite} disabled={inviteState === "creating"} className={`${primaryBtn} w-full`}>
                {inviteState === "creating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
                상대와 비교해보기
              </button>
              <p className="mt-2 text-center text-[12px] font-medium text-[#9a9188]">
                두 분이 모두 하면 비교 리포트를 준비해 드려요 (준비 중)
              </p>
              {inviteLink && (
                <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-[#eadfc9] bg-[#fffdf7] px-3 py-2.5">
                  <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#34445a]">{inviteLink}</p>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteLink);
                        setInviteState("copied");
                      } catch { /* 수동 복사 안내 유지 */ }
                    }}
                    className="shrink-0 text-[#36534E]"
                    aria-label="링크 복사"
                  >
                    {inviteState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              )}
              {inviteState === "copied" && (
                <p className="mt-1.5 text-center text-[12px] font-semibold text-[#36534E]">링크를 복사했어요 — 카톡으로 보내보세요</p>
              )}
              {inviteState === "error" && (
                <p className="mt-1.5 text-center text-[12px] font-semibold text-red-500">링크 생성에 실패했어요. 잠시 후 다시 시도해주세요.</p>
              )}
            </div>
          )}
          <Link
            href="/check"
            onClick={() => captureEvent("wedding_code_to_quote_check", {})}
            className={`${ghostBtn} w-full`}
          >
            <ClipboardCheck className="h-4 w-4" />
            내 견적 체크하러 가기 (무료·로그인 없음)
          </Link>
        </div>

        {/* 섹션 C — 내 선택 전부 보기 (문항 번호 순 고정 — 정렬·그룹핑 없음) */}
        <div className={`${card} mt-7 overflow-hidden`}>
          <button
            onClick={() => setAllOpen(!allOpen)}
            className="flex w-full items-center justify-between px-6 py-4 text-left"
          >
            <span className="text-[14px] font-semibold text-[#263832]">내 선택 전부 보기</span>
            {allOpen ? <ChevronUp className="h-4 w-4 text-[#9a9188]" /> : <ChevronDown className="h-4 w-4 text-[#9a9188]" />}
          </button>
          {allOpen && (
            <div className="divide-y divide-[#f0e9db] border-t border-[#eadfc9]">
              {WC_QUESTIONS.map((q) => {
                const answer = backup.answers[q.key];
                const option = q.options.find((o) => o.value === answer);
                return (
                  <div key={q.key} className="px-6 py-3.5">
                    <p className="text-[11px] font-semibold text-[#9d6f36]">{WC_SCENARIO_SUMMARIES[q.key]}</p>
                    <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#34445a]">
                      {option ? option.label : <span className="text-[#9a9188]">건너뜀</span>}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 섹션 D — 오늘의 대화 카드 (제안형, 판정 없음) */}
        <div className={`${card} mt-5 p-6`}>
          <p className="text-[11px] font-semibold tracking-wide text-[#9d6f36]">오늘의 대화 카드</p>
          <p className="mt-2 text-[14px] font-medium leading-[1.75] text-[#263832]">{talkText}</p>
        </div>

        <p className="mt-6 text-center text-[11px] font-medium text-[#b5ada3]">{WC_CARD_BRAND}</p>
      </div>
    </div>
  );
}
