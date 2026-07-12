"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import DatePickerPopover from "./DatePickerPopover";
import { weddingPath } from "@/lib/weddingPaths";
import TurnstileWidget from "@/components/auth/TurnstileWidget";
import { shouldShowBetaCounter } from "@/constants/beta";
import { readStoredUtm } from "@/utils/utm";
import { ymdInKst } from "@/lib/utils/kstDate";

const TURNSTILE_ENABLED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
const COMING_SOON = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

interface BetaFormProps {
  current: number;
  applicationsEnabled: boolean;
}

type Role = "bride" | "groom" | "";

export default function BetaForm({ current, applicationsEnabled }: BetaFormProps) {
  const [earliestWeddingDate, setEarliestWeddingDate] = useState("2026-07-01");
  const showCounter = shouldShowBetaCounter(current);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [role, setRole] = useState<Role>("");
  const [message, setMessage] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [verificationEmailSent, setVerificationEmailSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  useEffect(() => {
    setEarliestWeddingDate(ymdInKst());
  }, []);

  if (!applicationsEnabled) {
    return (
      <div
        className="rounded-[28px] border border-white/15 bg-white/[0.055] p-8 md:p-10"
        role="status"
      >
        <p className="mb-6 text-[11px] font-medium tracking-[0.28em] text-rose-light">
          사용자 연구 접수 준비 중
        </p>
        <h2 className="mb-5 font-serif-kr text-[24px] font-light leading-snug text-white md:text-[28px]">
          안전 확인을 마친 뒤<br />신청을 열게요
        </h2>
        <p className="mb-8 text-[14px] font-light leading-[1.85] text-white/70">
          이메일 소유 확인, 신청 정보 삭제, 선정 안내 절차까지 실제 환경에서 검증하고 있습니다.
          준비가 끝나기 전에는 개인정보를 받지 않습니다.
        </p>
        <Link
          href="/demo"
          className="group inline-flex items-center gap-2 border-b border-white pb-2 text-[14px] font-medium tracking-[0.02em] text-white transition-colors hover:border-rose-light hover:text-rose-light"
        >
          서비스 소개 보기
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !email.includes("@")) {
      setError("유효한 이메일을 입력해주세요.");
      return;
    }
    if (!role) {
      setError("신부 또는 신랑을 선택해주세요.");
      return;
    }
    if (!privacyConsent) {
      setError("개인정보 수집·이용 안내를 확인하고 동의해주세요.");
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
          role: role || undefined,
          message: message || undefined,
          isBetaCandidate: true,
          privacyConsent,
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
      setVerificationEmailSent(data.verificationEmailSent === true);
      setSuccess(true);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="border border-white/15 rounded-[28px] bg-white/[0.055] p-10 md:p-12" role="status" aria-live="polite">
        <div className="w-12 h-12 rounded-full bg-rose-light/20 flex items-center justify-center mb-6">
          <Check className="w-6 h-6 text-rose-light" />
        </div>
        <h2 className="font-serif-kr text-[24px] md:text-[28px] text-white font-light leading-snug mb-5 tracking-[-0.005em]">
          {verificationEmailSent ? (
            <>이제 이메일을 <em className="not-italic text-rose-light">확인해주세요</em></>
          ) : (
            <>신청은 저장됐지만 <em className="not-italic text-rose-light">메일 발송이 지연되고 있어요</em></>
          )}
        </h2>
        <p className="text-white/80 text-[15px] leading-[1.85] font-light mb-3">
          {verificationEmailSent
            ? "아래 주소로 보낸 메일 링크를 열고, 2시간 이내에 확인 페이지의 버튼까지 눌러주세요."
            : "잠시 뒤 같은 이메일로 다시 제출하면 새 확인 링크 발송을 다시 시도합니다."}
          <br />
          <span className="text-white/60">{email}</span>
        </p>
        <p className="text-[12px] text-white/50 leading-relaxed mb-8">
          이메일 확인은 선정을 의미하지 않습니다. 확인 후 신청 내용을 검토해 참여 여부와 다음 단계를 별도로 안내드릴게요.
          메일이 보이지 않거나 만료됐다면 같은 이메일로 다시 제출하면 새 확인 링크를 받을 수 있습니다.
        </p>

        <div className="h-px w-full bg-white/10 mb-8" aria-hidden />

        <p className="text-white/70 text-[14px] leading-[1.85] mb-6 font-light">
          {COMING_SOON
            ? "웨딩한방이 준비 중인 기능과 운영 원칙을 서비스 소개에서 확인하실 수 있어요."
            : "기다리는 동안 커뮤니티에서 먼저 결혼 준비하시는 분들의 이야기를 둘러보셔도 좋아요."}
        </p>
        <Link
          href={COMING_SOON ? "/demo" : weddingPath()}
          className="group inline-flex items-center gap-2 text-[14px] text-white font-medium border-b border-white pb-2 tracking-[0.02em] hover:text-rose-light hover:border-rose-light transition-colors"
        >
          {COMING_SOON ? "서비스 소개로 돌아가기" : "커뮤니티 둘러보기"}
          <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="border border-white/15 rounded-[28px] bg-white/[0.055] p-8 md:p-10">
      <p className="text-[11px] tracking-[0.28em] text-rose-light font-medium mb-6">
        사용자 연구 코호트 · 최대 50명 선정
      </p>

      {showCounter ? (
        <>
          {/* 진척 — 숫자는 sans-serif + tabular-nums (Cormorant "1"이 Roman "I"로 보이는 이슈 방지) */}
          <div className="flex items-baseline gap-3 mb-3">
            <span className="font-sans tabular-nums text-white text-[56px] md:text-[64px] font-light leading-none tracking-[-0.02em]">
              {current}
            </span>
            <span className="text-white/50 text-lg font-light">건 확인 완료</span>
          </div>
          <p className="text-[11px] tracking-[0.22em] text-white/50 mb-6 font-medium">
            이메일 확인을 마친 신청을 검토해 최대 50명을 선정합니다
          </p>
          <div className="h-px bg-white/10 w-full mb-10" aria-hidden />
        </>
      ) : (
        <p className="mb-10 text-[13px] font-medium tracking-[0.16em] text-white/55">
          사용자 연구 신청 접수 중
        </p>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="이메일" required>
          <input
            type="email"
            aria-label="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full rounded-xl border border-white/25 bg-transparent px-3.5 py-3 text-[15px] font-normal text-white outline-none transition-colors placeholder:text-white/50 focus:border-rose-light/70 disabled:opacity-50"
            disabled={submitting}
          />
        </Field>

        <Field label="이름">
          <input
            type="text"
            aria-label="이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="김OO"
            className="w-full rounded-xl border border-white/25 bg-transparent px-3.5 py-3 text-[15px] font-normal text-white outline-none transition-colors placeholder:text-white/50 focus:border-rose-light/70 disabled:opacity-50"
            disabled={submitting}
          />
        </Field>

        <fieldset>
          <legend className="mb-2.5 block text-[11px] font-medium tracking-[0.2em] text-white/75">
            역할 <span className="ml-1 text-rose-light">*</span>
          </legend>
          <div className="flex gap-3">
            {([
              { value: "bride" as const, label: "신부" },
              { value: "groom" as const, label: "신랑" },
            ]).map((opt) => (
              <label
                key={opt.value}
                className={`flex-1 cursor-pointer rounded-xl border py-3 text-center text-sm font-medium transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-rose-light/60 ${
                  role === opt.value
                    ? "bg-rose-light/20 border-rose-light text-white"
                    : "border-white/25 text-white/75 hover:border-white/40 hover:text-white"
                } ${submitting ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <input
                  type="radio"
                  name="beta-role"
                  value={opt.value}
                  checked={role === opt.value}
                  onChange={() => setRole(opt.value)}
                  disabled={submitting}
                  required
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="예식 예정일">
          <DatePickerPopover
            value={weddingDate}
            onChange={setWeddingDate}
            min={earliestWeddingDate}
            max="2026-12-31"
            disabled={submitting}
            placeholder="날짜 선택"
          />
          <p className="mt-1.5 text-[11px] text-white/55">2026년 7~12월 (미정이면 비워두셔도 됩니다)</p>
        </Field>

        <Field label="한 줄 메시지">
          <textarea
            aria-label="한 줄 메시지"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="아모라를 어떻게 알게 되셨는지, 어떤 부분이 궁금하신지 알려주세요."
            rows={3}
            className="w-full resize-none rounded-xl border border-white/25 bg-transparent px-3.5 py-3 text-[15px] font-normal text-white outline-none transition-colors placeholder:text-white/50 focus:border-rose-light/70 disabled:opacity-50"
            disabled={submitting}
            maxLength={300}
          />
        </Field>

        <label className="flex items-start gap-3 rounded-xl border border-white/20 bg-white/[0.03] p-4 text-[12px] leading-relaxed text-white/80">
          <input
            type="checkbox"
            checked={privacyConsent}
            onChange={(event) => setPrivacyConsent(event.target.checked)}
            disabled={submitting}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#d4afa0]"
          />
          <span>
            2026년 하반기 6주 사용자 연구 신청 접수·참여 검토·결과 안내를 위해 필수로 이메일·역할,
            선택으로 이름·예식일·메시지를 수집하고, 동의 시각·정책 버전·접수 메일 상태, 해당하는 경우
            이메일 확인 시각과 유입 캠페인 정보(UTM)를 처리하는 데 동의합니다. 이 정보는 다른 베타 모집 목적으로 전환하지 않습니다.
            신청 정보의 보관 기준은 접수일로부터 180일입니다. 보관기간이 지난 신청은 매일 한 번 정리되어,
            만료 후 최대 약 24시간 이내 삭제됩니다. 그 전에도 삭제를 요청할 수 있습니다.{" "}
            <Link href="/privacy" className="font-medium text-white underline underline-offset-2">
              개인정보처리방침
            </Link>
          </span>
        </label>

        {TURNSTILE_ENABLED && <TurnstileWidget onVerify={setTurnstileToken} />}

        {error && (
          <p className="text-[13px] text-rose-light leading-relaxed" role="alert">{error}</p>
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
              사용자 연구 신청하기
              <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-2.5 block text-[11px] font-medium tracking-[0.2em] text-white/75">
        {label}
        {required && <span className="text-rose-light ml-1">*</span>}
      </span>
      {children}
    </div>
  );
}
