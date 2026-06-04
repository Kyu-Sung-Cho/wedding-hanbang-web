"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import DatePickerPopover from "./DatePickerPopover";
import { weddingPath } from "@/lib/weddingPaths";

interface BetaFormProps {
  current: number;
  total: number;
  progress: number;
}

type Role = "bride" | "groom" | "";

export default function BetaForm({ current, total, progress }: BetaFormProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [role, setRole] = useState<Role>("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
    setSubmitting(true);
    try {
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
        <h2 className="font-serif-kr text-[24px] md:text-[28px] text-white font-light leading-snug mb-5 tracking-[-0.005em]">
          신청 <em className="not-italic text-rose-light">접수 완료</em>
        </h2>
        <p className="text-white/80 text-[15px] leading-[1.85] font-light mb-3">
          감사합니다. 2~3일 이내 참여 확정 메일을 보내드릴게요.
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
        베타 50쌍 한정
      </p>

      {/* 진척 — 숫자는 sans-serif + tabular-nums (Cormorant "1"이 Roman "I"로 보이는 이슈 방지) */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="font-sans tabular-nums text-white text-[56px] md:text-[64px] font-light leading-none tracking-[-0.02em]">
          {current}
        </span>
        <span className="text-white/40 text-lg font-light tabular-nums">/ {total}</span>
      </div>
      <p className="text-[11px] tracking-[0.22em] text-white/50 mb-6 font-medium">
        현재 신청 · 명
      </p>
      <div className="h-px bg-white/10 w-full relative overflow-hidden mb-10">
        <div
          className="absolute top-0 left-0 h-full bg-rose-light transition-all duration-700"
          style={{ width: `${Math.max(progress, 3)}%` }}
          aria-hidden
        />
      </div>

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

        <Field label="역할" required>
          <div className="flex gap-3">
            {([
              { value: "bride" as const, label: "신부" },
              { value: "groom" as const, label: "신랑" },
            ]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRole(opt.value)}
                disabled={submitting}
                className={`flex-1 py-3 text-sm font-medium rounded-xl border transition-colors ${
                  role === opt.value
                    ? "bg-rose-light/20 border-rose-light text-white"
                    : "border-white/15 text-white/60 hover:border-white/30 hover:text-white/80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="예식 예정일">
          <DatePickerPopover
            value={weddingDate}
            onChange={setWeddingDate}
            min="2026-06-01"
            max="2026-12-31"
            disabled={submitting}
            placeholder="날짜 선택"
          />
          <p className="text-[11px] text-white/40 mt-1.5">2026년 6~12월 (미정이면 비워두셔도 됩니다)</p>
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
