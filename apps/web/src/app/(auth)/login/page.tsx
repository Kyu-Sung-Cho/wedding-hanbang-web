"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";
import { captureEvent } from "@/lib/analytics";
import TurnstileWidget from "@/components/auth/TurnstileWidget";
import { pathWithAuthReturn, sanitizeAuthReturnPath } from "@/lib/authReturnPath";

const TURNSTILE_ENABLED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

type Mode = "login" | "signup" | "forgot";

// 비밀번호 강도 체크
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

function currentReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return sanitizeAuthReturnPath(params.get("next") ?? params.get("redirect"));
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [touched, setTouched] = useState({ name: false, email: false, password: false, passwordConfirm: false });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);

  const passwordChecks = useMemo(() => checkPasswordStrength(password), [password]);

  // 콜백에서 전달된 에러 표시 (query params + hash fragment)
  useEffect(() => {
    // 1. query params 에러 (우리 콜백에서 설정)
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("error");
    const requestedMode = params.get("mode");

    if (requestedMode === "signup" || requestedMode === "forgot") {
      setMode(requestedMode);
    }

    // 2. hash fragment 에러 (Supabase가 직접 설정 - OAuth 실패 시)
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    const hashError = hashParams.get("error");
    const hashDescription = hashParams.get("error_description");

    if (hashDescription) {
      setError(`로그인 오류: ${decodeURIComponent(hashDescription.replace(/\+/g, " "))}`);
    } else if (hashError) {
      setError(`로그인 오류: ${decodeURIComponent(hashError)}`);
    } else if (callbackError) {
      setError(`로그인 오류: ${decodeURIComponent(callbackError)}`);
    }
  }, []);

  const handleOAuth = async (provider: "kakao" | "google" | "apple") => {
    setLoading(provider);
    setError("");
    // 실제 로그인 시작 시 데모 모드 쿠키 제거
    document.cookie = "demo_mode=; path=/; max-age=0";
    try {
      const supabase = createClient();
      const callbackUrl = new URL("/api/auth/callback", window.location.origin);
      const returnPath = currentReturnPath();
      if (returnPath) callbackUrl.searchParams.set("next", returnPath);
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl.toString(),
        },
      });
      if (oauthError) {
        console.error("OAuth error:", oauthError);
        setError(`소셜 로그인 오류: ${oauthError.message}`);
        setLoading(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("OAuth catch error:", msg);
      setLoading(null);
      setError(`소셜 로그인 실패: ${msg}`);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "forgot") {
      if (!email) { setError("이메일을 입력해주세요."); return; }
      if (TURNSTILE_ENABLED && !turnstileToken) { setError("봇 확인을 완료해주세요."); return; }
    } else if (!email || !password) {
      setError("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    if (mode === "signup") {
      if (!name.trim()) {
        setError("이름을 입력해주세요.");
        return;
      }
      if (!isPasswordValid(passwordChecks)) {
        setError("비밀번호 조건을 모두 충족해주세요.");
        return;
      }
      if (password !== passwordConfirm) {
        setError("비밀번호가 일치하지 않습니다.");
        return;
      }
      if (TURNSTILE_ENABLED && !turnstileToken) {
        setError("봇 확인을 완료해주세요.");
        return;
      }
    }

    setLoading("email");
    setError("");
    setSuccess("");
    // 실제 로그인 시작 시 데모 모드 쿠키 제거
    document.cookie = "demo_mode=; path=/; max-age=0";

    try {
      const supabase = createClient();

      if (mode === "signup") {
        // 서버 API로 회원가입 (Supabase Admin + Resend 이메일 발송)
        captureEvent("signup_started", { method: "email" });
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name, turnstileToken, next: currentReturnPath() }),
        });
        const result = await res.json();
        if (!res.ok) {
          setError(result.error || "회원가입에 실패했습니다.");
        } else {
          setSuccess(
            result.message ||
              "요청을 확인했습니다. 가입 가능한 이메일이면 인증 안내가 도착합니다."
          );
        }
      } else if (mode === "forgot") {
        // 서버 API로 비밀번호 재설정 이메일 발송
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, turnstileToken }),
        });
        const result = await res.json().catch(() => ({}));
        if (res.ok) {
          setSuccess(
            result.message ||
              "요청을 확인했습니다. 해당 이메일로 재설정이 가능하면 안내가 도착합니다."
          );
        } else {
          setError(result.error || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          if (signInError.message === "Invalid login credentials") {
            setError("이메일 또는 비밀번호가 올바르지 않습니다.");
          } else if (signInError.message === "Email not confirmed") {
            setError("이메일 인증이 완료되지 않았습니다. 메일함을 확인해주세요.");
          } else {
            setError(signInError.message);
          }
        } else {
          const { data: { user: loggedInUser } } = await supabase.auth.getUser();
          if (loggedInUser) {
            const { data: profile, error: profileError } = await supabase
              .from("profiles")
              .select("onboarding_completed")
              .eq("id", loggedInUser.id)
              .maybeSingle();

            if (profileError) {
              console.error("로그인 후 프로필 조회 실패:", profileError.message);
              setError("프로필 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
              return;
            }

            if (profile?.onboarding_completed) {
              document.cookie = "onboarding_complete=true; path=/; max-age=2592000";
              window.location.href = currentReturnPath() ?? "/wedding/lounge";
            } else {
              window.location.href = pathWithAuthReturn("/wedding/onboarding", currentReturnPath());
            }
          } else {
            window.location.href = currentReturnPath() ?? "/wedding/lounge";
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Auth error:", msg);
      setError(`오류: ${msg}`);
    } finally {
      setLoading(null);
      if (mode === "signup" || mode === "forgot") {
        // Turnstile 토큰은 일회용이므로 요청마다 위젯까지 새로 만든다.
        setTurnstileToken("");
        setTurnstileAttempt((value) => value + 1);
      }
    }
  };

  const handleDemo = async () => {
    setLoading("demo");
    setError("");
    try {
      const res = await fetch("/api/demo/start", { method: "POST" });
      if (!res.ok) throw new Error("demo start failed");
      window.location.href = currentReturnPath() ?? "/wedding/lounge";
    } catch {
      setError("데모 모드를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_52%,#f5f8f1_100%)] flex items-center justify-center px-5">
      {/* 배경 장식 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -right-[5%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,#eef4f1,transparent)] blur-[100px] opacity-45" />
        <div className="absolute -bottom-[10%] -left-[5%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,#f6efe5,transparent)] blur-[100px] opacity-35" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* 로고 */}
        <div className="text-center mb-10">
          <Link href="/wedding">
            <Logo size="md" />
          </Link>
          <p className="text-[14px] text-[#635b51] font-light mt-3">
            AI 웨딩 플래너와 함께하는 결혼 준비
          </p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
          <>
              {/* 정상 로그인 모드 */}
              <h1 className="font-serif-kr text-[24px] font-light text-[#263832] text-center mb-2">
                {mode === "login" ? "로그인" : mode === "signup" ? "회원가입" : "비밀번호 찾기"}
              </h1>
              <p className="text-[13px] text-[#635b51] text-center mb-8">
                {mode === "login"
                  ? "계정에 로그인하세요"
                  : mode === "signup"
                    ? "이메일로 간편하게 가입하세요"
                    : "가입한 이메일을 입력해주세요"}
              </p>

              {/* 이메일 폼 */}
              <form onSubmit={handleEmailAuth} className="space-y-3 mb-4">
                {mode === "signup" && (
                  <div>
                    <label htmlFor="auth-name" className="sr-only">이름</label>
                    <input
                      id="auth-name"
                      type="text"
                      value={name}
                      onChange={(e) => { setName(e.target.value); setError(""); }}
                      onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                      placeholder="이름 *"
                      className={`w-full px-5 py-3.5 rounded-2xl border bg-white text-[14px] text-[#263832] outline-none transition-colors placeholder:text-[#928980] ${
                        touched.name && !name.trim() ? "border-[#9A6B62]" : "border-black/[0.06] focus:border-[#36534E]"
                      }`}
                    />
                    {touched.name && !name.trim() && (
                      <p className="text-[11px] text-[#9A6B62] mt-1 px-2">이름을 입력해주세요</p>
                    )}
                  </div>
                )}
                <label htmlFor="auth-email" className="sr-only">이메일</label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder={mode === "signup" ? "이메일 *" : "이메일"}
                  className="w-full px-5 py-3.5 rounded-2xl border border-black/[0.06] bg-white text-[14px] text-[#263832] outline-none focus:border-[#36534E] transition-colors placeholder:text-[#928980]"
                />

                {/* 비밀번호 (forgot 모드에서는 숨김) */}
                {mode !== "forgot" && <div className="relative">
                  <label htmlFor="auth-password" className="sr-only">비밀번호</label>
                  <input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    placeholder={mode === "signup" ? "비밀번호 *" : "비밀번호"}
                    className="w-full px-5 py-3.5 pr-12 rounded-2xl border border-black/[0.06] bg-white text-[14px] text-[#263832] outline-none focus:border-[#36534E] transition-colors placeholder:text-[#928980]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#928980] hover:text-[#36534E] transition-colors"
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
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
                </div>}

                {/* 비밀번호 강도 표시 (회원가입 모드) */}
                {mode === "signup" && password.length > 0 && (
                  <div className="px-2 space-y-1.5">
                    <div className="flex gap-1.5">
                      {[passwordChecks.minLength, passwordChecks.hasLowercase, passwordChecks.hasUppercase, passwordChecks.hasNumber, passwordChecks.hasSpecial].map((ok, i) => (
                        <div key={i} className={`flex-1 h-1 rounded-full transition-colors ${ok ? "bg-[#36534E]" : "bg-[#e5d8ca]"}`} />
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
                        <p key={item.label} className={`text-[11px] flex items-center gap-1 ${item.ok ? "text-[#36534E]" : "text-[#928980]"}`}>
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

                {/* 비밀번호 확인 (회원가입 모드) */}
                {mode === "signup" && (
                  <div>
                    <div className="relative">
                      <label htmlFor="auth-password-confirm" className="sr-only">비밀번호 확인</label>
                      <input
                        id="auth-password-confirm"
                        type={showPasswordConfirm ? "text" : "password"}
                        value={passwordConfirm}
                        onChange={(e) => { setPasswordConfirm(e.target.value); setError(""); }}
                        onBlur={() => setTouched((t) => ({ ...t, passwordConfirm: true }))}
                        placeholder="비밀번호 확인 *"
                        className={`w-full px-5 py-3.5 pr-12 rounded-2xl border bg-white text-[14px] text-[#263832] outline-none transition-colors placeholder:text-[#928980] ${
                          touched.passwordConfirm && passwordConfirm && password !== passwordConfirm
                            ? "border-[#9A6B62]"
                            : "border-black/[0.06] focus:border-[#36534E]"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-[#928980] hover:text-[#36534E] transition-colors"
                        aria-label={showPasswordConfirm ? "비밀번호 확인 숨기기" : "비밀번호 확인 보기"}
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
                    {touched.passwordConfirm && passwordConfirm && password !== passwordConfirm && (
                      <p className="text-[11px] text-[#9A6B62] mt-1 px-2">비밀번호가 일치하지 않습니다</p>
                    )}
                    {touched.passwordConfirm && passwordConfirm && password === passwordConfirm && passwordConfirm.length > 0 && (
                      <p className="text-[11px] text-[#36534E] mt-1 px-2 flex items-center gap-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        비밀번호 일치
                      </p>
                    )}
                  </div>
                )}

                {/* 봇 확인 — 이메일 발송 표면(회원가입·비밀번호 찾기)에 노출 */}
                {(mode === "signup" || mode === "forgot") && TURNSTILE_ENABLED && (
                  <TurnstileWidget
                    key={`${mode}-${turnstileAttempt}`}
                    onVerify={setTurnstileToken}
                  />
                )}

                {error && (
                  <p className="text-[12px] text-[#9A6B62] px-1" role="alert" aria-live="assertive">{error}</p>
                )}
                {success && (
                  <div className="bg-[#36534E]/5 border border-[#36534E]/20 rounded-xl px-4 py-3" role="status" aria-live="polite">
                    <p className="text-[13px] text-[#36534E] font-medium flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      {success}
                    </p>
                    <p className="text-[11px] text-[#36534E]/70 mt-1">안내가 도착하면 스팸 메일함도 확인해주세요</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading !== null || (mode === "signup" && (!isPasswordValid(passwordChecks) || password !== passwordConfirm || !name.trim() || (TURNSTILE_ENABLED && !turnstileToken))) || (mode === "forgot" && (!email || (TURNSTILE_ENABLED && !turnstileToken)))}
                  className="w-full py-3.5 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 bg-gradient-to-br from-[#36534E] to-[#2B423E] text-white shadow-[0_4px_14px_0_rgba(54,83,78,0.20)] hover:shadow-[0_6px_20px_rgba(54,83,78,0.24)] disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
                >
                  {loading === "email"
                    ? "처리 중..."
                    : mode === "login"
                      ? "로그인"
                      : mode === "signup"
                        ? "회원가입"
                        : "비밀번호 재설정 링크 보내기"}
                </button>
                {mode === "signup" && (
                  <p className="px-2 text-center text-[11px] leading-5 text-[#635b51]">
                    회원가입을 누르면 <Link href="/terms" className="underline underline-offset-2">이용약관</Link>과{" "}
                    <Link href="/privacy" className="underline underline-offset-2">개인정보처리방침</Link>에 동의합니다.
                  </p>
                )}
              </form>

              {/* 모드 전환 */}
              <div className="text-[13px] text-[#635b51] text-center mb-6 space-y-1.5">
                {mode === "login" && (
                  <>
                    <p>
                      아직 계정이 없으신가요?{" "}
                      <button
                        onClick={() => { setMode("signup"); setError(""); setSuccess(""); setPassword(""); setPasswordConfirm(""); setTurnstileToken(""); setTouched({ name: false, email: false, password: false, passwordConfirm: false }); }}
                        className="text-[#36534E] font-medium hover:underline"
                      >
                        회원가입
                      </button>
                    </p>
                    <p>
                      <button
                        onClick={() => { setMode("forgot"); setError(""); setSuccess(""); setPassword(""); setPasswordConfirm(""); setTurnstileToken(""); }}
                        className="text-[#635b51] hover:text-[#36534E] hover:underline transition-colors"
                      >
                        비밀번호를 잊으셨나요?
                      </button>
                    </p>
                  </>
                )}
                {mode === "signup" && (
                  <p>
                    이미 계정이 있으신가요?{" "}
                    <button
                      onClick={() => { setMode("login"); setError(""); setSuccess(""); setPassword(""); setPasswordConfirm(""); setTurnstileToken(""); setTouched({ name: false, email: false, password: false, passwordConfirm: false }); }}
                      className="text-[#36534E] font-medium hover:underline"
                    >
                      로그인
                    </button>
                  </p>
                )}
                {mode === "forgot" && (
                  <p>
                    <button
                      onClick={() => { setMode("login"); setError(""); setSuccess(""); setPassword(""); setPasswordConfirm(""); setTurnstileToken(""); }}
                      className="text-[#36534E] font-medium hover:underline"
                    >
                      ← 로그인으로 돌아가기
                    </button>
                  </p>
                )}
              </div>

              {/* 구분선 */}
              <div className="flex items-center gap-4 mb-5">
                <div className="flex-1 h-px bg-platinum" />
                <span className="text-[11px] text-[#928980]">소셜 로그인</span>
                <div className="flex-1 h-px bg-platinum" />
              </div>

              {/* 소셜 로그인 */}
              <div className="flex gap-3 mb-5">
                <button
                  onClick={() => handleOAuth("kakao")}
                  disabled={loading !== null}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-medium transition-all hover:-translate-y-0.5 bg-[#FEE500] text-[#191919] hover:shadow-[0_4px_16px_rgba(254,229,0,0.3)]"
                >
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                    <path d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.63 5.18l-.93 3.44c-.08.3.26.54.52.37l4.1-2.72c.22.02.44.03.68.03 4.42 0 8-2.79 8-6.3C17 3.79 13.42 1 9 1z" fill="#191919"/>
                  </svg>
                  카카오
                </button>
                <button
                  onClick={() => handleOAuth("google")}
                  disabled={loading !== null}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-medium transition-all hover:-translate-y-0.5 bg-white border border-black/[0.08] text-[#071629] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                >
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                    <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92a8.78 8.78 0 002.68-6.62z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" fill="#34A853"/>
                    <path d="M3.97 10.71A5.41 5.41 0 013.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96l3.01 2.33C4.68 5.17 6.66 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  Google
                </button>
                <button
                  onClick={() => handleOAuth("apple")}
                  disabled={loading !== null}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-medium transition-all hover:-translate-y-0.5 bg-black text-white hover:shadow-[0_4px_16px_rgba(0,0,0,0.15)]"
                >
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                    <path d="M13.1 3.6c.7-.9 1.2-2.1 1.1-3.3-1 .1-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.2 1.2.1 2.3-.6 3-1.5zM14.1 9.5c0-2.5 2-3.7 2.1-3.8-1.1-1.7-2.9-1.9-3.5-2-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.8-3.2-.8C3.9 3.8 2 5.4 2 8.7c0 2 .8 4 1.7 5.4.8 1.1 1.7 2.4 2.9 2.3 1.1-.1 1.6-.7 2.9-.7s1.8.7 3 .7c1.2 0 2.1-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.9z" fill="white"/>
                  </svg>
                  Apple
                </button>
              </div>

              {/* 구분선 */}
              <div className="flex items-center gap-4 mb-5">
                <div className="flex-1 h-px bg-platinum" />
                <span className="text-[11px] text-[#928980]">또는</span>
                <div className="flex-1 h-px bg-platinum" />
              </div>

              {/* 데모 체험 */}
              <button
                onClick={handleDemo}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 border-[1.5px] border-[#36534E]/35 text-[#36534E] hover:border-[#36534E] hover:bg-[#EEF4F1]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
                </svg>
                로그인 없이 체험하기
              </button>

              <p className="text-[11px] text-[#928980] text-center mt-4 font-light">
                체험 모드에서는 모든 기능을 미리 둘러볼 수 있습니다
              </p>
          </>
        </div>

        {/* 하단 링크 */}
        <div className="flex items-center justify-center gap-4 mt-6">
          <Link href="/wedding" className="text-[13px] text-[#635b51] hover:text-[#36534E] transition-colors">
            ← 홈으로
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
