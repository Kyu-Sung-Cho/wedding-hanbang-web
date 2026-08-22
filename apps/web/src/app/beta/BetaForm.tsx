"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import DatePickerPopover from "./DatePickerPopover";
import { weddingPath } from "@/lib/weddingPaths";
import TurnstileWidget from "@/components/auth/TurnstileWidget";
import { shouldShowBetaCounter } from "@/constants/beta";
import { readStoredUtm } from "@/utils/utm";
import { PUBLIC_COUPLE_SUPPORT_COPY } from "@/constants/coupleRoleSupport";

const TURNSTILE_ENABLED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/**
 * 예식일 선택 범위. 2026년 6~12월로 못 박혀 있어서 2027년 예식을 준비하는
 * 사람은 날짜를 넣을 수조차 없었다. 서버는 유효한 ISO 날짜면 다 받는다.
 */
function isoDaysFromToday(days: number): string {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + days);
  const offsetMs = base.getTimezoneOffset() * 60_000;
  return new Date(base.getTime() - offsetMs).toISOString().slice(0, 10);
}

interface BetaFormProps {
  /** 지금까지 사전등록한 사람 수. 정원이 아니라 사실 하나다. */
  current: number;
}

export default function BetaForm({ current }: BetaFormProps) {
  const showCounter = shouldShowBetaCounter(current);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !email.includes("@")) {
      setError("유효한 이메일을 입력해주세요.");
      return;
    }
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError("봇 확인을 완료해주세요.");
      return;
    }
    setSubmitting(true);
    try {
      // first-touch UTM(유통 링크가 /check·/wedding으로 들어온 경우) 우선,
      // 없으면 현재 URL 쿼리 폴백 — 채널 전환 측정(G1)의 데이터원.
      const storedUtm = readStoredUtm();
      const currentParams = new URLSearchParams(window.location.search);
      const utmSource = storedUtm?.source ?? currentParams.get("utm_source") ?? undefined;
      const utmMedium = storedUtm?.medium ?? currentParams.get("utm_medium") ?? undefined;
      const utmCampaign = storedUtm?.campaign ?? currentParams.get("utm_campaign") ?? undefined;

      const res = await fetch("/api/preregister", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: name || undefined,
          weddingDate: weddingDate || undefined,
          message: message || undefined,
          isBetaCandidate: true,
          turnstileToken,
          utmSource,
          utmMedium,
          utmCampaign,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "신청 중 오류가 발생했습니다.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="border border-white/15 rounded-[28px] p-10 md:p-12 backdrop-blur-sm bg-white/[0.03]">
        <div className="w-12 h-12 rounded-full bg-rose-light/20 flex items-center justify-center mb-6">
          <Check className="w-6 h-6 text-rose-light" />
        </div>
        <h2 className="font-serif-kr text-[24px] md:text-[28px] text-white font-light leading-snug mb-5 tracking-normal">
          신청 <em className="not-italic text-rose-light">접수 완료</em>
        </h2>
        <p className="text-white/80 text-[15px] leading-[1.85] font-light mb-3">
          감사합니다. 등록하신 주소로 접수 확인 메일을 보냈어요. 새 소식이 생기면 이 주소로 알려드릴게요.
          <br />
          <span className="text-white/60">{email}</span>
        </p>
        <p className="text-[12px] text-white/50 leading-relaxed mb-8">
          모집 현황은 약 1분 후 반영됩니다.
        </p>

        <div className="h-px w-full bg-white/10 mb-8" aria-hidden />

        <p className="text-white/70 text-[14px] leading-[1.85] mb-6 font-light">
          기다리는 동안 커뮤니티에서 먼저 결혼 준비하시는 분들의 이야기를 둘러보셔도 좋아요.
        </p>
        <Link
          href={weddingPath()}
          className="group inline-flex items-center gap-2 text-[14px] text-white font-medium border-b border-white pb-2 tracking-[0.02em] hover:text-rose-light hover:border-rose-light transition-colors"
        >
          커뮤니티 둘러보기
          <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="border border-white/15 rounded-[28px] p-8 md:p-10 backdrop-blur-sm bg-white/[0.03]">
      <p className="text-[11px] tracking-[0.28em] text-rose-light font-medium mb-6">
        베타 신청 현황
      </p>

      {showCounter ? (
        <>
          {/* "N / 50쌍" 이라고 적고 진척 막대를 그렸었다. 두 가지가 거짓이다.
              (1) 세는 것은 preregistrations 의 **이메일 행**이지 커플이 아니다.
              (2) 50 은 정원이 아니다 — 심사도 정원도 없고, 계정은 승인 없이
                  바로 만들 수 있다. 없는 희소성을 만들면 기다릴 이유가 없는
                  사람을 기다리게 한다. 숫자만 사실대로 보여준다. */}
          <div className="flex items-baseline gap-3 mb-3">
            <span className="font-sans tabular-nums text-white text-[56px] md:text-[64px] font-light leading-none tracking-normal">
              {current}
            </span>
            <span className="text-white/40 text-lg font-light">명</span>
          </div>
          <p className="text-[11px] tracking-[0.22em] text-white/50 mb-10 font-medium">
            지금까지 사전등록
          </p>
        </>
      ) : (
        <p className="mb-10 text-[13px] font-medium tracking-[0.16em] text-white/55">
          베타 신청 접수 중
        </p>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="이메일" required>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="input-base"
            disabled={submitting}
          />
        </Field>

        <Field label="이름">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="김OO"
            className="input-base"
            disabled={submitting}
          />
        </Field>

        {/* 역할(신부/신랑)은 묻지 않는다 — 중립 준비 공간이 켜진 뒤로
            온보딩도 묻지 않으므로, 여기서만 묻는 것은 제품과 어긋난다.
            남는 사실은 "한 공간에 두 사람"이라는 정원 제한뿐이다. */}
        <div
          id="beta-role-support-note"
          className="space-y-1 text-[11px] leading-relaxed text-white/50"
        >
          <p>{PUBLIC_COUPLE_SUPPORT_COPY.current}</p>
          <p>{PUBLIC_COUPLE_SUPPORT_COPY.planned}</p>
        </div>

        <Field label="예식 예정일">
          <DatePickerPopover
            value={weddingDate}
            onChange={setWeddingDate}
            min={isoDaysFromToday(0)}
            max={isoDaysFromToday(365 * 3)}
            disabled={submitting}
            placeholder="날짜 선택"
          />
          <p className="text-[11px] text-white/40 mt-1.5">아직 못 정했으면 비워두셔도 됩니다</p>
        </Field>

        <Field label="한 줄 메시지">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="아모라를 어떻게 알게 되셨는지, 어떤 부분이 궁금하신지 알려주세요."
            rows={3}
            className="input-base resize-none"
            disabled={submitting}
            maxLength={300}
          />
        </Field>

        {TURNSTILE_ENABLED && (
          <TurnstileWidget action="preregister" onVerify={setTurnstileToken} />
        )}

        {error && (
          <p className="text-[13px] text-rose-light leading-relaxed">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="group inline-flex items-center gap-2 text-[15px] text-white font-medium border-b border-white pb-2 tracking-[0.02em] hover:text-rose-light hover:border-rose-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              전송 중…
            </>
          ) : (
            <>
              베타 신청하기
              <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

      {/* 인라인 스타일 */}
      <style jsx>{`
        .input-base {
          width: 100%;
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 12px 14px;
          color: white;
          font-size: 15px;
          font-weight: 300;
          outline: none;
          transition: border-color 0.15s;
        }
        .input-base:focus {
          border-color: rgba(212, 175, 160, 0.6);
        }
        .input-base::placeholder {
          color: rgba(255, 255, 255, 0.3);
        }
        .input-base:disabled {
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] tracking-[0.2em] text-white/60 mb-2.5 block font-medium">
        {label}
        {required && <span className="text-rose-light ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}
