"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import Logo from "@/components/ui/Logo";
import { getSameOriginRedirectPath } from "@/lib/auth/safeRedirect";
import {
  captureAndClearSensitiveAuthUrl,
  consumePendingPasswordRecovery,
} from "@/lib/auth/sensitiveAuthUrl";
import { createClient } from "@/lib/supabase/client";
import {
  getPasswordPolicyChecks,
  isStrongUserPassword,
} from "@hanbang/shared/security/password-policy";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  const passwordChecks = useMemo(() => getPasswordPolicyChecks(password), [password]);

  useEffect(() => {
    let active = true;

    // createBrowserClient보다 먼저 URL을 비워 SDK/관측성 계층이 토큰을
    // 수집하지 못하게 하고, 서버가 발급한 일회용 recovery token만 검증한다.
    captureAndClearSensitiveAuthUrl();
    const pendingRecovery = consumePendingPasswordRecovery();
    const supabase = createClient();

    const restoreRecoverySession = async () => {
      try {
        if (pendingRecovery?.kind !== "token_hash") {
          throw new Error("missing recovery token");
        }

        const { data, error: sessionError } = await supabase.auth.verifyOtp({
          token_hash: pendingRecovery.tokenHash,
          type: "recovery",
        });
        if (sessionError || !data.session) throw new Error("invalid recovery token");

        if (active) {
          setError("");
          setReady(true);
        }
      } catch {
        if (active) {
          setReady(false);
          setError("복구 링크가 만료되었거나 유효하지 않습니다. 비밀번호 찾기를 다시 진행해주세요.");
        }
      }
    };

    void restoreRecoverySession();

    return () => {
      active = false;
    };
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStrongUserPassword(password)) {
      setError("비밀번호 조건을 모두 충족해주세요.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError("비밀번호 변경에 실패했습니다. 다시 시도해주세요.");
      } else {
        // 계정 탈취 대응: 복구가 끝나면 모든 refresh session을 폐기하고,
        // 원격 폐기가 일시 실패해도 이 브라우저의 recovery session은 제거한다.
        const { error: globalSignOutError } = await supabase.auth.signOut({ scope: "global" });
        if (globalSignOutError) {
          await supabase.auth.signOut({ scope: "local" });
        }
        setSuccess(true);
        // redirect 쿼리 파라미터가 있으면 해당 경로로, 없으면 /login으로
        const params = new URLSearchParams(window.location.search);
        const redirectTo = params.get("redirect") || "/login";
        const safePath = getSameOriginRedirectPath(redirectTo, window.location.origin);
        setTimeout(() => {
          window.location.href = safePath;
        }, 2000);
      }
    } catch {
      setError("비밀번호 변경에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep flex items-center justify-center px-5">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -right-[5%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,var(--rose-pale),transparent)] blur-[100px] opacity-25" />
        <div className="absolute -bottom-[10%] -left-[5%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,var(--gold-light),transparent)] blur-[100px] opacity-25" />
      </div>

      <div className="relative z-10 w-full max-w-[420px] animate-fade-in">
        <div className="text-center mb-10">
          <Link href="/">
            <Logo size="md" />
          </Link>
          <p className="text-[14px] text-taupe-500 font-light mt-3">
            새로운 비밀번호를 설정해주세요
          </p>
        </div>

        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
          {success ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#2E7D5A]/10 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#2E7D5A]">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <h1 className="font-serif-kr text-[24px] font-light text-noir-800 mb-2">
                비밀번호 변경 완료
              </h1>
              <p className="text-[14px] text-taupe-500 font-light">
                로그인 페이지로 이동합니다...
              </p>
            </div>
          ) : !ready ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-rose-500/10 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`text-rose-500 ${error ? "" : "animate-spin"}`}>
                  {error
                    ? <><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>
                    : <><path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="10" /></>}
                </svg>
              </div>
              <h1 className="font-serif-kr text-[24px] font-light text-noir-800 mb-2">
                {error ? "복구 링크를 확인해주세요" : "인증 확인 중"}
              </h1>
              <p className="text-[14px] text-taupe-500 font-light">
                {error || "잠시만 기다려주세요..."}
              </p>
              <p className="text-[12px] text-taupe-400 mt-4">
                이 페이지가 계속 표시되면{" "}
                <a href="/login" className="text-rose-500 hover:underline">
                  비밀번호 찾기
                </a>
                를 다시 시도해주세요.
              </p>
            </div>
          ) : (
            <>
              <h1 className="font-serif-kr text-[24px] font-light text-noir-800 text-center mb-2">
                새 비밀번호 설정
              </h1>
              <p className="text-[13px] text-taupe-400 text-center mb-8">
                새로운 비밀번호를 입력해주세요
              </p>

              <form onSubmit={handleReset} className="space-y-3">
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    placeholder="새 비밀번호"
                    className="w-full px-5 py-3.5 pr-12 rounded-2xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-taupe-400 hover:text-noir-800 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>

                {/* 비밀번호 강도 표시 */}
                {password.length > 0 && (
                  <div className="px-2 space-y-1.5">
                    <div className="flex gap-1.5">
                      {[passwordChecks.minLength, passwordChecks.hasLowercase, passwordChecks.hasUppercase, passwordChecks.hasNumber, passwordChecks.hasSpecial].map((ok, i) => (
                        <div key={i} className={`flex-1 h-1 rounded-full transition-colors ${ok ? "bg-[#2E7D5A]" : "bg-taupe-300/40"}`} />
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {[
                        { label: "8자 이상", ok: passwordChecks.minLength },
                        { label: "대문자 포함", ok: passwordChecks.hasUppercase },
                        { label: "소문자 포함", ok: passwordChecks.hasLowercase },
                        { label: "숫자 포함", ok: passwordChecks.hasNumber },
                        { label: "특수문자 포함", ok: passwordChecks.hasSpecial },
                      ].map((item) => (
                        <p key={item.label} className={`text-[11px] flex items-center gap-1 ${item.ok ? "text-[#2E7D5A]" : "text-taupe-400"}`}>
                          {item.ok ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>
                          )}
                          {item.label}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* 비밀번호 확인 */}
                <div>
                  <div className="relative">
                    <input
                      type={showPasswordConfirm ? "text" : "password"}
                      value={passwordConfirm}
                      onChange={(e) => { setPasswordConfirm(e.target.value); setError(""); }}
                      placeholder="비밀번호 확인"
                      className={`w-full px-5 py-3.5 pr-12 rounded-2xl border bg-white text-[14px] text-noir-800 outline-none transition-colors placeholder:text-taupe-400 ${
                        passwordConfirm && password !== passwordConfirm
                          ? "border-rose-500/50"
                          : "border-black/[0.06] focus:border-rose-500"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-taupe-400 hover:text-noir-800 transition-colors"
                      tabIndex={-1}
                    >
                      {showPasswordConfirm ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                  {passwordConfirm && password !== passwordConfirm && (
                    <p className="text-[11px] text-rose-500 mt-1 px-2">비밀번호가 일치하지 않습니다</p>
                  )}
                  {passwordConfirm && password === passwordConfirm && passwordConfirm.length > 0 && (
                    <p className="text-[11px] text-[#2E7D5A] mt-1 px-2 flex items-center gap-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      비밀번호 일치
                    </p>
                  )}
                </div>

                {error && (
                  <p className="text-[12px] text-rose-600 px-1">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !isStrongUserPassword(password) || password !== passwordConfirm}
                  className="w-full py-3.5 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
                >
                  {loading ? "처리 중..." : "비밀번호 변경"}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-4 mt-6">
          <a href="/login" className="text-[13px] text-taupe-400 hover:text-rose-500 transition-colors">
            ← 로그인으로
          </a>
        </div>
      </div>
    </div>
  );
}
