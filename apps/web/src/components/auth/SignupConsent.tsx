"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import {
  SIGNUP_CONSENT_ITEMS,
  isSignupConsentAll,
  setAllSignupConsent,
  type SignupConsentKey,
  type SignupConsentState,
} from "@hanbang/shared";

type SignupConsentProps = Readonly<{
  value: SignupConsentState;
  onChange: (next: SignupConsentState) => void;
  disabled?: boolean;
}>;

function Box({ checked, size }: { checked: boolean; size: "lg" | "sm" }) {
  const box = size === "lg" ? "size-5" : "size-[18px]";
  return (
    <span
      aria-hidden="true"
      className={`${box} shrink-0 rounded-md border flex items-center justify-center transition-colors ${
        checked
          ? "border-[#36534E] bg-[#36534E] text-white"
          : "border-black/[0.14] bg-white text-transparent"
      }`}
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

/**
 * 가입 동의. 필수 2건(이용약관·개인정보 처리방침)과 선택 1건(마케팅)이다.
 *
 * 항목은 접지 않는다 — 필수 동의 항목이 기본 상태에서 보이지 않으면
 * 무엇에 동의했는지 확인할 수 없다. 전문 링크는 새 탭으로 연다.
 * 입력 중이던 가입 폼이 날아가면 안 된다.
 */
export default function SignupConsent({
  value,
  onChange,
  disabled = false,
}: SignupConsentProps) {
  const all = isSignupConsentAll(value);

  const toggle = (key: SignupConsentKey) => {
    onChange({ ...value, [key]: !value[key] });
  };

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3.5">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={all}
        onClick={() => onChange(setAllSignupConsent(!all))}
        className="flex w-full items-center gap-2.5 text-left disabled:opacity-50"
      >
        <Box checked={all} size="lg" />
        <span className="text-[14px] font-medium text-[#263832]">전체 동의</span>
      </button>

      <div className="my-3 h-px bg-black/[0.06]" />

      <ul className="space-y-2.5">
        {SIGNUP_CONSENT_ITEMS.map((item) => (
          <li key={item.key} className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={disabled}
              aria-pressed={value[item.key]}
              onClick={() => toggle(item.key)}
              className="flex flex-1 items-center gap-2.5 text-left disabled:opacity-50"
            >
              <Box checked={value[item.key]} size="sm" />
              <span className="text-[13px] text-[#4E6A62]">
                <span
                  className={
                    item.required
                      ? "font-medium text-[#36534E]"
                      : "text-[#928980]"
                  }
                >
                  {item.required ? "[필수]" : "[선택]"}
                </span>{" "}
                {item.label}
              </span>
            </button>
            {item.href && (
              <Link
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[12px] text-[#928980] underline underline-offset-2 hover:text-[#36534E]"
              >
                보기
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
