"use client";

import { useState, useEffect, useMemo } from "react";
import InvitationAuthShell from "@/components/auth/InvitationAuthShell";
import Button from "@/components/ui/Button";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/authErrorMessages";
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

function toKoreanAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : String(err ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("same password") || lower.includes("different from the old password")) {
    return "이전과 다른 새로운 비밀번호를 입력해주세요.";
  }
  if (lower.includes("weak_password") || lower.includes("password should be")) {
    return "비밀번호 조건을 다시 확인해주세요.";
  }
  if (lower.includes("auth session missing") || lower.includes("session_not_found") || lower.includes("expired")) {
    return "재설정 세션이 만료되었습니다. 비밀번호 찾기를 다시 진행해주세요.";
  }
  if (lower.includes("failed to fetch") || lower.includes("load failed") || lower.includes("networkerror")) {
    return "네트워크 연결을 확인한 뒤 다시 시도해주세요.";
  }
  return "비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.";
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
  // 세션이 없다는 것이 **확정된** 상태. 회전만 계속 돌리면 사용자는 기다리다 나간다.
  const [noSession, setNoSession] = useState(false);

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
      if (cancelled) return;
      if (data.session) setReady(true);
      // 세션이 없으면 **여기서 끝난다.** 회전을 계속 돌리면 무엇이 잘못됐는지
      // 알려주지 않은 채 사람을 붙잡아 두게 된다.
      else setNoSession(true);
    });

    // 링크를 직접 붙여넣는 등 클라이언트가 세션을 세우는 경로도 남겨 둔다.
    const { data: listener } = supabase.auth.onAuthStateChange((event: string) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
        setNoSession(false);
      }
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
        setError(toKoreanAuthError(updateError));
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
      setError(toKoreanAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // 2026-11-20 파운더 "로그인 페이지도 다 바꿔야": 로그인과 같은 틀(시작 화면 모양)에 넣는다. 문장과 동작은 그대로다.
  // 로고 아래 한 줄("새로운 비밀번호를 설정해주세요")은 틀의 amora·한 줄이 대신하고, 같은 뜻은 폼 제목 아래에 남는다.
  return (
    <InvitationAuthShell labelledBy="reset-title">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-inv-stone">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-inv-ink">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <h1 id="reset-title" className="m-0 font-inv-serif text-[24px] font-normal leading-[1.45] text-inv-ink">
                비밀번호 변경 완료
              </h1>
              <p className="-mt-2 text-[15px] leading-[1.7] text-inv-body">
                로그인 페이지로 이동합니다...
              </p>
            </div>
          ) : noSession ? (
            /* 세션이 없는 것이 **확정된** 상태. 예전에는 이때도 회전을 계속 돌려
               무엇이 잘못됐는지 알려주지 않은 채 사람을 붙잡아 뒀다. */
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-inv-stone">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-inv-warn">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
                </svg>
              </div>
              <h1 id="reset-title" className="m-0 font-inv-serif text-[24px] font-normal leading-[1.45] text-inv-ink">
                링크를 확인하지 못했어요
              </h1>
              <p className="-mt-2 text-[15px] leading-[1.7] text-inv-body">
                {AUTH_ERROR_MESSAGES.link_expired}
              </p>
              <a
                href="/login"
                className="mt-2.5 inline-flex h-14 w-full items-center justify-center rounded-[28px] bg-inv-ink text-[16px] font-bold text-inv-white"
              >
                로그인 화면으로
              </a>
            </div>
          ) : !ready ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-inv-stone">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin text-inv-muted">
                  <path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="10" />
                </svg>
              </div>
              <h1 id="reset-title" className="m-0 font-inv-serif text-[24px] font-normal leading-[1.45] text-inv-ink">
                인증 확인 중
              </h1>
              <p className="-mt-2 text-[15px] leading-[1.7] text-inv-body">
                잠시만 기다려주세요...
              </p>
            </div>
          ) : (
            <>
              <h1 id="reset-title" className="m-0 font-inv-serif text-[24px] font-normal leading-[1.45] text-inv-ink">
                새 비밀번호 설정
              </h1>
              <p className="-mt-2 text-[15px] leading-[1.7] text-inv-body">
                새로운 비밀번호를 입력해주세요
              </p>

              <form onSubmit={handleReset} className="flex flex-col gap-3">
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    placeholder="새 비밀번호"
                    className="h-[52px] w-full rounded-[18px] border border-inv-chip-line bg-inv-white px-5 pr-12 text-[15px] text-inv-ink outline-none transition-colors placeholder:text-inv-faint focus:border-inv-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-inv-muted transition-colors hover:text-inv-ink"
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
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${ok ? "bg-inv-ink" : "bg-inv-chip-line"}`} />
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
                        <p key={item.label} className={`flex items-center gap-1 text-[12px] ${item.ok ? "text-inv-ink" : "text-inv-muted"}`}>
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
                      className={`h-[52px] w-full rounded-[18px] border bg-inv-white px-5 pr-12 text-[15px] text-inv-ink outline-none transition-colors placeholder:text-inv-faint ${
                        passwordConfirm && password !== passwordConfirm
                          ? "border-inv-warn"
                          : "border-inv-chip-line focus:border-inv-ink"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-inv-muted transition-colors hover:text-inv-ink"
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
                    <p className="mt-1 px-2 text-[12px] text-inv-warn">비밀번호가 일치하지 않습니다</p>
                  )}
                  {passwordConfirm && password === passwordConfirm && passwordConfirm.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 px-2 text-[12px] text-inv-ink">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      비밀번호 일치
                    </p>
                  )}
                </div>

                {error && (
                  <p className="px-1 text-[13px] leading-[1.6] text-inv-warn">{error}</p>
                )}

                <Button
                  type="submit"
                  variant="ink"
                  size="pill-56"
                  weight="bold"
                  fullWidth
                  disabled={loading || !isPasswordValid(passwordChecks) || password !== passwordConfirm}
                  className="mt-2.5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? "처리 중..." : "비밀번호 변경"}
                </Button>
              </form>
            </>
          )}

        <div className="flex items-center justify-center border-t border-inv-divider pt-2">
          <a href="/login" className="inline-flex min-h-11 items-center text-[13px] text-inv-body transition-colors hover:text-inv-ink">
            ← 로그인으로
          </a>
        </div>
    </InvitationAuthShell>
  );
}
