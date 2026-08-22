"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import Logo from "@/components/ui/Logo";
import { getSameOriginRedirectPath } from "@/lib/auth/safeRedirect";
import { createClient } from "@/lib/supabase/client";

interface PasswordCheck {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

function checkPasswordStrength(pw: string): PasswordCheck {
  return {
    minLength: pw.length >= 8,
    hasUppercase: /[A-Z]/.test(pw),
    hasLowercase: /[a-z]/.test(pw),
    hasNumber: /[0-9]/.test(pw),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pw),
  };
}

function isPasswordValid(checks: PasswordCheck): boolean {
  return checks.minLength && checks.hasUppercase && checks.hasLowercase && checks.hasNumber && checks.hasSpecial;
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  const passwordChecks = useMemo(() => checkPasswordStrength(password), [password]);

  useEffect(() => {
    // 세션은 **서버**가 세운다(`/api/auth/confirm`). 여기서는 그 세션이 있는지만
    // 확인하고 폼을 연다.
    //
    // ⚠️ 예전에는 `PASSWORD_RECOVERY` 이벤트만 기다렸다. 그 이벤트는 브라우저가
    // 해시(`#access_token=…`)를 직접 해석할 때만 오는데, `@supabase/ssr` 의
    // createBrowserClient 가 `flowType:"pkce"` 를 덮어쓸 수 없게 박아 둬서
    // (createBrowserClient.js:34,38) auth-js 가 해시를 만나면 세션을 만들기 전에
    // 예외를 던졌다. 그래서 **이벤트가 영원히 오지 않았고**, 이 화면은
    // "인증 확인 중"에서 멈춘 채 비밀번호를 바꿀 방법이 사라졌다.
    let cancelled = false;
    const supabase = createClient();

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) setReady(true);
    });

    // 링크를 직접 붙여넣는 등 클라이언트가 세션을 세우는 경로도 남겨 둔다.
    const { data: listener } = supabase.auth.onAuthStateChange((event: string) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid(passwordChecks)) {
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
        setSuccess(true);
        // redirect 쿼리 파라미터가 있으면 해당 경로로, 없으면 /login으로
        const params = new URLSearchParams(window.location.search);
        const redirectTo = params.get("redirect") || "/login";
        const safePath = getSameOriginRedirectPath(redirectTo, window.location.origin);
        setTimeout(() => {
          window.location.href = safePath;
        }, 2000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`오류: ${msg}`);
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
          <Link href="/landing">
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
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-rose-500 animate-spin">
                  <path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="10" />
                </svg>
              </div>
              <h1 className="font-serif-kr text-[24px] font-light text-noir-800 mb-2">
                인증 확인 중
              </h1>
              <p className="text-[14px] text-taupe-500 font-light">
                잠시만 기다려주세요...
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
                  disabled={loading || !isPasswordValid(passwordChecks) || password !== passwordConfirm}
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
