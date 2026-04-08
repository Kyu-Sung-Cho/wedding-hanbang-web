"use client";

import { useState } from "react";

interface CoupleLinkProps {
  coupleAction: "create" | "join" | null;
  onSelectAction: (action: "create" | "join") => void;
  partnerCode: string;
  onPartnerCodeChange: (code: string) => void;
}

export default function CoupleLink({
  coupleAction,
  onSelectAction,
  partnerCode,
  onPartnerCodeChange,
}: CoupleLinkProps) {
  const [codeError, setCodeError] = useState("");

  const handleCodeChange = (val: string) => {
    // WH-XXXXXX 형식 자동 포맷
    const clean = val.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    onPartnerCodeChange(clean);
    setCodeError("");
  };

  const validateCode = (code: string) => {
    if (!code) {
      setCodeError("코드를 입력해주세요");
      return false;
    }
    if (!/^WH-[A-Z0-9]{6}$/.test(code)) {
      setCodeError("올바른 형식이 아닙니다 (예: WH-A3B2C1)");
      return false;
    }
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[25px] font-semibold text-noir-800 mb-2">
          커플 연동
        </h2>
        <p className="text-[23px] text-taupe-400">
          파트너와 함께 결혼 준비를 관리하세요
        </p>
      </div>

      <div className="space-y-3">
        {/* 새로 시작하기 */}
        <button
          onClick={() => onSelectAction("create")}
          className={`w-full p-5 rounded-2xl border-2 text-left transition-all ${
            coupleAction === "create"
              ? "border-rose-500 bg-rose-500/5"
              : "border-black/[0.06] bg-white hover:border-black/[0.12]"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-noir-800 text-white flex items-center justify-center text-[23px]">
              +
            </div>
            <div>
              <div className="text-[21px] font-semibold text-noir-800">
                새로 시작하기
              </div>
              <div className="text-[23px] text-taupe-400">
                초대 코드를 받아 파트너에게 공유하세요
              </div>
            </div>
          </div>
        </button>

        {/* 파트너 코드 입력 */}
        <button
          onClick={() => onSelectAction("join")}
          className={`w-full p-5 rounded-2xl border-2 text-left transition-all ${
            coupleAction === "join"
              ? "border-rose-500 bg-rose-500/5"
              : "border-black/[0.06] bg-white hover:border-black/[0.12]"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-rose-500 text-white flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div>
              <div className="text-[21px] font-semibold text-noir-800">
                파트너 코드 입력
              </div>
              <div className="text-[23px] text-taupe-400">
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
            placeholder="WH-A3B2C1"
            maxLength={9}
            className="w-full px-5 py-3.5 rounded-2xl border border-black/[0.06] bg-white text-[23px] text-noir-800 text-center tracking-[0.2em] font-mono outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400 placeholder:tracking-[0.2em]"
          />
          {codeError && (
            <p className="text-[23px] text-rose-600 text-center">{codeError}</p>
          )}
        </div>
      )}

      {coupleAction === "create" && (
        <div className="bg-ivory-100 rounded-2xl p-4 text-center">
          <p className="text-[21px] text-taupe-500">
            온보딩 완료 후 초대 코드가 생성됩니다.
            <br />
            코드를 파트너에게 공유하면 연동됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
