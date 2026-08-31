"use client";

import { useState } from "react";
import {
  COUPLE_INVITE_CODE_MAX_LENGTH,
  COUPLE_INVITE_CODE_PLACEHOLDER,
  describeCoupleInviteCodeProblem,
  normalizeCoupleInviteCode,
} from "@hanbang/shared";

interface CoupleLinkProps {
  coupleAction: "create" | "join" | null;
  onSelectAction: (action: "create" | "join") => void;
  partnerCode: string;
  onPartnerCodeChange: (code: string) => void;
  /**
   * 초대 링크를 눌러서 들어와 코드가 미리 채워졌을 때 보여줄 한 줄.
   * 없으면 아무것도 그리지 않는다 — 직접 친 사람에게는 설명할 것이 없다.
   */
  prefilledNotice?: string;
}

export default function CoupleLink({
  coupleAction,
  onSelectAction,
  partnerCode,
  onPartnerCodeChange,
  prefilledNotice,
}: CoupleLinkProps) {
  const [codeError, setCodeError] = useState("");

  // 형식 규칙은 `@hanbang/shared`에 한 벌만 둔다. 예전에는 웹과 앱이 각자 갖고 있었고,
  // 앱 쪽 길이 제한만 10자로 남아 있어 15자 코드가 잘려 파트너 연결이 아예 막혔다.
  const handleCodeChange = (val: string) => {
    onPartnerCodeChange(normalizeCoupleInviteCode(val));
    setCodeError("");
  };

  const validateCode = (code: string) => {
    const problem = describeCoupleInviteCodeProblem(code);
    setCodeError(problem ?? "");
    return problem === null;
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[22px] font-semibold text-[var(--hb-text-strong)] mb-2">
          커플 연동
        </h2>
        <p className="text-[14px] text-[var(--hb-text-muted)]">
          파트너와 함께 결혼 준비를 관리하세요
        </p>
      </div>

      <div className="space-y-3">
        {/* 새로 시작하기 */}
        <button
          onClick={() => onSelectAction("create")}
          className={`w-full p-5 rounded-[6px] border-2 text-left transition-all ${
            coupleAction === "create"
              ? "border-rose-500 bg-rose-500/5"
              : "border-black/[0.06] bg-white hover:border-black/[0.12]"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--hb-primary)] text-white flex items-center justify-center text-[18px]">
              +
            </div>
            <div>
              <div className="text-[15px] font-semibold text-[var(--hb-text-strong)]">
                새로 시작하기
              </div>
              <div className="text-[12px] text-[var(--hb-text-muted)]">
                초대 코드를 받아 파트너에게 공유하세요
              </div>
            </div>
          </div>
        </button>

        {/* 파트너 코드 입력 */}
        <button
          onClick={() => onSelectAction("join")}
          className={`w-full p-5 rounded-[6px] border-2 text-left transition-all ${
            coupleAction === "join"
              ? "border-rose-500 bg-rose-500/5"
              : "border-black/[0.06] bg-white hover:border-black/[0.12]"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--hb-primary)] text-white flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div>
              <div className="text-[15px] font-semibold text-[var(--hb-text-strong)]">
                파트너 코드 입력
              </div>
              <div className="text-[12px] text-[var(--hb-text-muted)]">
                파트너에게 받은 초대 코드를 입력하세요
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* 코드 입력 필드 */}
      {coupleAction === "join" && (
        <div className="space-y-2 pt-2">
          <input
            type="text"
            value={partnerCode}
            onChange={(e) => handleCodeChange(e.target.value)}
            onBlur={() => partnerCode && validateCode(partnerCode)}
            placeholder={COUPLE_INVITE_CODE_PLACEHOLDER}
            maxLength={COUPLE_INVITE_CODE_MAX_LENGTH}
            className="w-full px-5 py-3.5 rounded-[6px] border border-black/[0.06] bg-white text-[16px] text-[var(--hb-text-strong)] text-center tracking-[0.2em] font-mono outline-none focus:border-rose-500 transition-colors placeholder:text-[var(--hb-text-muted)] placeholder:tracking-[0.2em]"
          />
          {prefilledNotice && !codeError && (
            <p className="text-[12px] text-[var(--hb-text-muted)] text-center">{prefilledNotice}</p>
          )}
          {codeError && (
            <p className="text-[12px] text-[var(--hb-accent-hover)] text-center">{codeError}</p>
          )}
        </div>
      )}

      {coupleAction === "create" && (
        <div className="bg-[var(--hb-surface-hover)] rounded-[6px] p-4 text-center">
          <p className="text-[13px] text-[var(--hb-text-body)]">
            온보딩 완료 후 초대 코드가 생성됩니다.
            <br />
            코드를 파트너에게 공유하면 연동됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
