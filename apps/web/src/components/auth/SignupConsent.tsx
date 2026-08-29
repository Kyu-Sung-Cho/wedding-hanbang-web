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

/**
 * 진짜 `<input type="checkbox">` 위에 그림을 얹는다.
 *
 * 처음에는 `<button aria-pressed>` 로 만들었다. 그러면 보조기술이 "토글 버튼,
 * 눌림"이라고 읽는데, 이건 **법적 동의 컨트롤**이라 "체크박스, 선택됨"으로
 * 읽혀야 맞다. 모바일도 accessibilityRole="checkbox" 를 쓴다.
 * 겸사겸사 손으로 만든 버튼도 둘 줄었다.
 */
function CheckBox({
  id,
  checked,
  disabled,
  onChange,
  size,
  labelledBy,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  size: "lg" | "sm";
  labelledBy: string;
}) {
  const box = size === "lg" ? "size-5" : "size-[18px]";
  return (
    <span className="relative inline-flex shrink-0">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-labelledby={labelledBy}
        className={`peer ${box} absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed`}
      />
      <span
        aria-hidden="true"
        className={`${box} rounded-md border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--hb-primary)] peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 ${
          checked
            ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white"
            : "border-black/[0.14] bg-white text-transparent"
        }`}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
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
      <div className="flex w-full items-center gap-2.5">
        <CheckBox
          id="signup-consent-all"
          checked={all}
          disabled={disabled}
          onChange={() => onChange(setAllSignupConsent(!all))}
          size="lg"
          labelledBy="signup-consent-all-label"
        />
        <label
          id="signup-consent-all-label"
          htmlFor="signup-consent-all"
          className="cursor-pointer text-[14px] font-medium text-[var(--hb-text-strong)]"
        >
          전체 동의
        </label>
      </div>

      <div className="my-3 h-px bg-black/[0.06]" />

      <ul className="space-y-2.5">
        {SIGNUP_CONSENT_ITEMS.map((item) => (
          <li key={item.key} className="flex items-center gap-2.5">
            <CheckBox
              id={`signup-consent-${item.key}`}
              checked={value[item.key]}
              disabled={disabled}
              onChange={() => toggle(item.key)}
              size="sm"
              labelledBy={`signup-consent-${item.key}-label`}
            />
            <label
              id={`signup-consent-${item.key}-label`}
              htmlFor={`signup-consent-${item.key}`}
              className="flex-1 cursor-pointer text-[13px] text-[var(--hb-text-body)]"
            >
              <span
                className={
                  item.required
                    ? "font-medium text-[var(--hb-text-strong)]"
                    : "text-[var(--hb-text-muted)]"
                }
              >
                {item.required ? "[필수]" : "[선택]"}
              </span>{" "}
              {item.label}
            </label>
            {item.href && (
              <Link
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[12px] text-[var(--hb-text-muted)] underline underline-offset-2 hover:text-[var(--hb-text-strong)]"
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
