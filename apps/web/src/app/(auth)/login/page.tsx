"use client";

import { useState, useLayoutEffect, useMemo } from "react";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import InvitationAuthShell from "@/components/auth/InvitationAuthShell";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { isPublicDemoTrialEnabled } from "@/lib/demoTrial";
import { captureEvent } from "@/lib/analytics";
import TurnstileWidget from "@/components/auth/TurnstileWidget";
import SignupConsent from "@/components/auth/SignupConsent";
import ExistingSessionReturn from "@/components/auth/ExistingSessionReturn";
import { AUTH_ERROR_FALLBACK, authErrorMessage } from "@/lib/auth/authErrorMessages";
import {
  hasAnyWebOAuthProvider,
  isWebOAuthProviderEnabled,
} from "@/lib/auth/oauthProviders";
import {
  EMPTY_SIGNUP_CONSENT,
  buildSignupConsentSubmission,
  isSignupConsentComplete,
  type SignupConsentState,
} from "@hanbang/shared";
import { loginModeFromSearch, type LoginMode } from "@/lib/auth/loginMode";
import {
  buildOAuthCallbackUrl,
  getPostLoginRedirectPath,
} from "@/lib/auth/safeRedirect";
import {
  forgetDemoAmoraPrefill,
  getStartHereHandoffIdFromRedirect,
  readDemoAmoraPrefill,
} from "@/lib/chat/demoHandoff";

const TURNSTILE_ENABLED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

const SOCIAL_PROVIDER_LABEL = {
  kakao: "카카오",
  google: "구글",
  apple: "Apple",
} as const;

// provider가 아직 열려 있지 않거나 설정이 끝나지 않았을 때 Supabase가 돌려주는
// 원문을 그대로 보여주면 사람은 알아볼 수 없고 내부 상태만 드러난다.
// 무엇이 안 됐는지와 대신 쓸 수 있는 길만 우리 말로 알린다.
function socialLoginFailureMessage(
  provider: keyof typeof SOCIAL_PROVIDER_LABEL,
): string {
  return `${SOCIAL_PROVIDER_LABEL[provider]} 로그인을 지금 이용할 수 없어요. 이메일로 로그인하거나 다른 방법을 이용해 주세요.`;
}

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

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("login");
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
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [cameFromStartHere, setCameFromStartHere] = useState(false);
  // 가입 동의. 로그인·비밀번호 찾기 모드에서는 쓰지 않는다.
  const [consent, setConsent] = useState<SignupConsentState>(EMPTY_SIGNUP_CONSENT);
  const consentComplete = isSignupConsentComplete(consent);

  const passwordChecks = useMemo(() => checkPasswordStrength(password), [password]);

  // 콜백에서 전달된 에러 표시 (query params + hash fragment)
  // 랜딩의 회원가입 CTA가 첫 페인트에서 로그인 화면으로 번쩍이지 않게
  // URL 모드를 브라우저가 그리기 전에 반영한다.
  useLayoutEffect(() => {
    // 1. query params 에러 (우리 콜백에서 설정)
    const params = new URLSearchParams(window.location.search);
    setMode(loginModeFromSearch(window.location.search));
    const startHereHandoffId = getStartHereHandoffIdFromRedirect(
      params.get("redirect"),
    );
    let hasValidStartHereHandoff = false;
    try {
      if (startHereHandoffId) {
        hasValidStartHereHandoff = Boolean(
          readDemoAmoraPrefill(window.localStorage, startHereHandoffId),
        );
      } else {
        // 일반 로그인에서는 같은 브라우저의 이전 방문자가 남긴 초안을 즉시 폐기한다.
        forgetDemoAmoraPrefill(window.localStorage);
      }
    } catch {
      // 브라우저 저장소가 막혔으면 연속성 안내 없이 일반 가입으로 진행한다.
    }
    try {
      // 직접 체험은 로그인 페이지를 거치지 않는다. 여기 남은 현재 탭 초안은
      // 중단된 이전 체험이므로 다음 로그인 사용자에게 넘어가기 전에 폐기한다.
      forgetDemoAmoraPrefill(window.sessionStorage);
    } catch {
      // 현재 탭 저장소 정리가 막혀도 로그인은 계속한다.
    }
    setCameFromStartHere(hasValidStartHereHandoff);
    const callbackError = params.get("error");

    // 2. hash fragment 에러 (Supabase가 직접 설정 - OAuth 실패 시)
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    const hashError = hashParams.get("error");
    const hashDescription = hashParams.get("error_description");

    // ⚠️ 예전에는 이 값들을 **그대로** 화면에 붙였다. 그래서 "로그인 오류: no_code"
    // 같은 내부 표현이 사용자에게 노출됐고, 값이 URL 에서 오므로 링크만 보내면
    // 누구나 이 화면에 아무 문장이나 띄울 수 있었다. 아는 코드만 우리말로 옮기고
    // 원문은 화면에 올리지 않는다. `error_description` 은 Supabase 가 붙이는
    // 영문 설명이라 표시 대상이 아니다 — 존재 여부만 실패 신호로 쓴다.
    const failure = hashError ?? (hashDescription ? "verify_failed" : null) ?? callbackError;
    const message = authErrorMessage(failure);
    if (message) setError(message);
  }, []);

  const handleOAuth = async (provider: "kakao" | "google" | "apple") => {
    setLoading(provider);
    setError("");
    // 실제 로그인 시작 시 데모 모드 쿠키 제거
    document.cookie = "demo_mode=; path=/; max-age=0";
    if (mode === "signup") {
      captureEvent("signup_started", {
        method: provider,
        source: cameFromStartHere ? "start_here" : "login_page",
      });
    }
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: buildOAuthCallbackUrl(
            window.location.search,
            window.location.origin,
          ),
        },
      });
      if (oauthError) {
        console.error("OAuth error:", oauthError);
        setError(socialLoginFailureMessage(provider));
        setLoading(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("OAuth catch error:", msg);
      setLoading(null);
      setError(socialLoginFailureMessage(provider));
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
        // 버튼이 잠겨 있어 보통은 닿지 않는다. 그래도 여기서 먼저 막는다 —
        // 아래 buildSignupConsentSubmission 이 던지면 그 식별자가
        // "오류: SIGNUP_CONSENT_REQUIRED" 로 사용자에게 그대로 보인다.
        if (!consentComplete) {
          setError("이용약관과 개인정보 처리방침에 동의해주세요.");
          setLoading(null);
          return;
        }
        // 서버 API로 회원가입 (Supabase Admin + Resend 이메일 발송)
        captureEvent("signup_started", {
          method: "email",
          source: cameFromStartHere ? "start_here" : "login_page",
        });
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name,
            turnstileToken,
            ...buildSignupConsentSubmission(consent),
            redirect: new URLSearchParams(window.location.search).get("redirect"),
          }),
        });
        const result = await res.json();
        if (!res.ok) {
          setError(result.error || "회원가입에 실패했습니다.");
          setTurnstileToken("");
          setTurnstileResetKey((k) => k + 1);
        } else {
          setSuccess(cameFromStartHere
            ? "인증 이메일을 보냈습니다. 같은 브라우저에서 인증하면 아모라 화면으로 이어져요."
            : "인증 이메일을 보냈습니다. 메일함을 확인해주세요!");
        }
      } else if (mode === "forgot") {
        // 서버 API로 비밀번호 재설정 이메일 발송
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, turnstileToken }),
        });
        if (res.ok) {
          setSuccess("비밀번호 재설정 링크를 이메일로 보냈습니다.");
        } else {
          setError("이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.");
          setTurnstileToken("");
          setTurnstileResetKey((k) => k + 1);
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
            // 원문을 그대로 올리면 한국어 서비스에서 영어 문장을 보게 된다.
            // 아는 경우는 위에서 옮겼고, 나머지는 폴백만 보여주고 원문은 버린다.
            setError(AUTH_ERROR_FALLBACK);
          }
        } else {
          const { data: { user: loggedInUser } } = await supabase.auth.getUser();
          if (loggedInUser) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("onboarding_completed")
              .eq("id", loggedInUser.id)
              .single();

            if (profile?.onboarding_completed) {
              document.cookie = "onboarding_complete=true; path=/; max-age=31536000";
              window.location.href = getPostLoginRedirectPath(
                window.location.search,
                window.location.origin,
                true,
              );
            } else {
              window.location.href = getPostLoginRedirectPath(
                window.location.search,
                window.location.origin,
                false,
              );
            }
          } else {
            window.location.href = getPostLoginRedirectPath(
              window.location.search,
              window.location.origin,
              true,
            );
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Auth error:", msg);
      // 연결이 끊기면 브라우저가 "Failed to fetch"(Safari 는 "Load failed")를
      // 던진다. 그대로 붙이면 지하철·엘리베이터에서 로그인한 사람이 영어 문장을
      // 보고 자기 계정 문제로 오해한다. 원문은 위 콘솔에만 남긴다.
      setError(AUTH_ERROR_FALLBACK);
      if (mode === "signup" || mode === "forgot") {
        setTurnstileToken("");
        setTurnstileResetKey((k) => k + 1);
      }
    } finally {
      setLoading(null);
    }
  };

  const handleDemo = async () => {
    setLoading("demo");
    setError("");
    try {
      const res = await fetch("/api/demo/start", { method: "POST" });
      if (!res.ok) throw new Error("demo start failed");
      window.location.href = getPostLoginRedirectPath(
        window.location.search,
        window.location.origin,
        true,
      );
    } catch {
      setError("데모 모드를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      setLoading(null);
    }
  };

  // 2026-11-20 파운더 "로그인 페이지도 다 바꿔야": 시작 화면과 같은 틀(사진·amora·유리 카드)에 넣는다.
  // 로그인·가입·OAuth·봇 확인·이동은 그대로이고, 바뀐 것은 겉모양(글꼴·색·입력칸·버튼)뿐이다.
  return (
    <InvitationAuthShell labelledBy="auth-title">
      <ExistingSessionReturn mode={mode} />
          <>
              {/* 정상 로그인 모드 */}
              <h1 id="auth-title" className="m-0 font-inv-serif text-[24px] font-normal leading-[1.45] text-inv-ink">
                {mode === "login" ? "로그인" : mode === "signup" ? "회원가입" : "비밀번호 찾기"}
              </h1>
              <p className="-mt-2 text-[15px] leading-[1.7] text-inv-body">
                {mode === "login"
                  ? "계정에 로그인하세요"
                  : mode === "signup"
                    ? cameFromStartHere
                      ? "가입하고 방금 확인한 준비를 이어가세요"
                      : "간편하게 가입하고 준비를 이어가세요"
                    : "가입한 이메일을 입력해주세요"}
              </p>

              {cameFromStartHere && mode === "signup" ? (
                <div role="status" className="rounded-[20px] bg-inv-stone px-4 py-4 text-left">
                  <p className="text-[14px] font-semibold text-inv-ink">방금 본 준비를 이어갈게요.</p>
                  <p className="mt-1 text-[13px] leading-[1.65] text-inv-body">
                    같은 브라우저에서 30분 안에 이 가입 흐름을 마치면, 임시로 남긴 첫 질문을 입력창에서 확인한 뒤 직접 보낼 수 있어요. 다른 기기나 다른 로그인 경로에서는 날짜를 다시 확인해 주세요.
                  </p>
                  <p className="mt-2 text-[13px] leading-[1.65] text-inv-body">
                    가입 후 바로 아모라와 첫 질문을 이어갈 수 있어요. 현재 무료로 제공됩니다.
                  </p>
                </div>
              ) : null}

              {/* provider 가 하나도 안 켜져 있으면 "빠르게 로그인하기" 제목과
                  구분선만 덩그러니 남는다. 자리째 감춘다. */}
              {mode !== "forgot" && hasAnyWebOAuthProvider() ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-inv-divider" />
                    <span className="text-[12px] text-inv-muted">
                      {mode === "signup" ? "빠르게 가입하기" : "빠르게 로그인하기"}
                    </span>
                    <div className="h-px flex-1 bg-inv-divider" />
                  </div>

                  <div className="flex gap-2">
                    {/* 카카오는 운영 Supabase 에서 꺼져 있다(authorize -> 400
                        "provider is not enabled"). 눌러도 동작하지 않는 버튼은
                        없는 것보다 나쁘다 — 모바일이 이미 같은 규칙을 쓴다. */}
                    {isWebOAuthProviderEnabled("kakao") ? (
                    <button
                      onClick={() => handleOAuth("kakao")}
                      disabled={loading !== null}
                      className="flex h-12 min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#FEE500] text-[14px] font-medium text-[#191919] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.63 5.18l-.93 3.44c-.08.3.26.54.52.37l4.1-2.72c.22.02.44.03.68.03 4.42 0 8-2.79 8-6.3C17 3.79 13.42 1 9 1z" fill="#191919"/>
                      </svg>
                      카카오
                    </button>
                    ) : null}
                    {isWebOAuthProviderEnabled("google") ? (
                    <button
                      onClick={() => handleOAuth("google")}
                      disabled={loading !== null}
                      className="flex h-12 min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-inv-chip-line bg-inv-white text-[14px] font-medium text-inv-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92a8.78 8.78 0 002.68-6.62z" fill="#4285F4"/>
                        <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" fill="#34A853"/>
                        <path d="M3.97 10.71A5.41 5.41 0 013.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" fill="#FBBC05"/>
                        <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96l3.01 2.33C4.68 5.17 6.66 3.58 9 3.58z" fill="#EA4335"/>
                      </svg>
                      Google
                    </button>
                    ) : null}
                    {isWebOAuthProviderEnabled("apple") ? (
                    <button
                      onClick={() => handleOAuth("apple")}
                      disabled={loading !== null}
                      /* Apple 로그인 버튼은 검정·흰색·흰색+테두리 세 가지만 허용된다(Sign in with
                         Apple 브랜드 규정). 2026-09-16에 팔레트의 `black` 을 따뜻한 잉크로 돌리면서
                         이 버튼까지 갈색이 될 뻔했다 — 여기만 진짜 검정으로 못 박는다. */
                      className="flex h-12 min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#000000] text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M13.1 3.6c.7-.9 1.2-2.1 1.1-3.3-1 .1-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.2 1.2.1 2.3-.6 3-1.5zM14.1 9.5c0-2.5 2-3.7 2.1-3.8-1.1-1.7-2.9-1.9-3.5-2-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.8-3.2-.8C3.9 3.8 2 5.4 2 8.7c0 2 .8 4 1.7 5.4.8 1.1 1.7 2.4 2.9 2.3 1.1-.1 1.6-.7 2.9-.7s1.8.7 3 .7c1.2 0 2.1-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.9z" fill="white"/>
                      </svg>
                      Apple
                    </button>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-inv-divider" />
                    <span className="text-[12px] text-inv-muted">또는 이메일로</span>
                    <div className="h-px flex-1 bg-inv-divider" />
                  </div>
                </>
              ) : null}

              {/* 이메일 폼 */}
              <form onSubmit={handleEmailAuth} className="flex flex-col gap-3">
                {mode === "signup" && (
                  <div>
                    <input
                      type="text"
                      aria-label="이름"
                      value={name}
                      onChange={(e) => { setName(e.target.value); setError(""); }}
                      onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                      placeholder="이름 *"
                      className={`h-[52px] w-full rounded-[18px] border bg-inv-white px-5 text-[15px] text-inv-ink outline-none transition-colors placeholder:text-inv-faint ${
                        touched.name && !name.trim() ? "border-inv-warn" : "border-inv-chip-line focus:border-inv-ink"
                      }`}
                    />
                    {touched.name && !name.trim() && (
                      <p className="mt-1 px-2 text-[12px] text-inv-warn">이름을 입력해주세요</p>
                    )}
                  </div>
                )}
                <input
                  type="email"
                  aria-label="이메일"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder={mode === "signup" ? "이메일 *" : "이메일"}
                  className="h-[52px] w-full rounded-[18px] border border-inv-chip-line bg-inv-white px-5 text-[15px] text-inv-ink outline-none transition-colors placeholder:text-inv-faint focus:border-inv-ink"
                />

                {/* 비밀번호 (forgot 모드에서는 숨김) */}
                {mode !== "forgot" && <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    aria-label="비밀번호"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    placeholder={mode === "signup" ? "비밀번호 *" : "비밀번호"}
                    className="h-[52px] w-full rounded-[18px] border border-inv-chip-line bg-inv-white px-5 pr-12 text-[15px] text-inv-ink outline-none transition-colors placeholder:text-inv-faint focus:border-inv-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
                    aria-pressed={showPassword}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-inv-muted transition-colors hover:text-inv-ink"
                  >
                    {showPassword ? <EyeOff aria-hidden="true" className="size-[18px]" /> : <Eye aria-hidden="true" className="size-[18px]" />}
                  </button>
                </div>}

                {/* 비밀번호 강도 표시 (회원가입 모드) */}
                {mode === "signup" && password.length > 0 && (
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

                {/* 비밀번호 확인 (회원가입 모드) */}
                {mode === "signup" && (
                  <div>
                    <div className="relative">
                      <input
                        type={showPasswordConfirm ? "text" : "password"}
                        aria-label="비밀번호 확인"
                        value={passwordConfirm}
                        onChange={(e) => { setPasswordConfirm(e.target.value); setError(""); }}
                        onBlur={() => setTouched((t) => ({ ...t, passwordConfirm: true }))}
                        placeholder="비밀번호 확인 *"
                        className={`h-[52px] w-full rounded-[18px] border bg-inv-white px-5 pr-12 text-[15px] text-inv-ink outline-none transition-colors placeholder:text-inv-faint ${
                          touched.passwordConfirm && passwordConfirm && password !== passwordConfirm
                            ? "border-inv-warn"
                            : "border-inv-chip-line focus:border-inv-ink"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                        aria-label={showPasswordConfirm ? "비밀번호 확인 숨기기" : "비밀번호 확인 표시"}
                        aria-pressed={showPasswordConfirm}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-inv-muted transition-colors hover:text-inv-ink"
                      >
                        {showPasswordConfirm ? <EyeOff aria-hidden="true" className="size-[18px]" /> : <Eye aria-hidden="true" className="size-[18px]" />}
                      </button>
                    </div>
                    <div className="min-h-6 flow-root">
                      {touched.passwordConfirm && passwordConfirm && password !== passwordConfirm && (
                        <p className="mt-1 px-2 text-[12px] text-inv-warn">비밀번호가 일치하지 않습니다</p>
                      )}
                      {touched.passwordConfirm && passwordConfirm && password === passwordConfirm && passwordConfirm.length > 0 && (
                        <p className="mt-1 flex items-center gap-1 px-2 text-[12px] text-inv-ink">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          비밀번호 일치
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* 필수 동의 — 이 화면에는 약관·처리방침 링크가 하나도 없었다.
                    가입 버튼과 소셜 버튼 양쪽이 이 상태를 본다. */}
                {mode === "signup" && (
                  <SignupConsent
                    value={consent}
                    onChange={setConsent}
                    disabled={loading !== null}
                  />
                )}

                {/* 봇 확인 — 이메일 발송 표면(회원가입·비밀번호 찾기)에 노출 */}
                {(mode === "signup" || mode === "forgot") && TURNSTILE_ENABLED && (
                  <TurnstileWidget
                    key={turnstileResetKey}
                    action={mode === "signup" ? "signup" : "forgot"}
                    onVerify={setTurnstileToken}
                  />
                )}

                {error && (
                  <p className="px-1 text-[13px] leading-[1.6] text-inv-warn">{error}</p>
                )}
                {success && (
                  <div className="rounded-[20px] bg-inv-stone px-4 py-3">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-inv-ink">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      {success}
                    </p>
                    <p className="mt-1 text-[12px] text-inv-body">스팸 메일함도 확인해주세요</p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="ink"
                  size="pill-56"
                  weight="bold"
                  fullWidth
                  className="mt-2.5 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={loading !== null || (mode === "signup" && (!isPasswordValid(passwordChecks) || password !== passwordConfirm || !name.trim() || !consentComplete || (TURNSTILE_ENABLED && !turnstileToken))) || (mode === "forgot" && (!email || (TURNSTILE_ENABLED && !turnstileToken)))}
                >
                  {loading === "email"
                    ? "처리 중..."
                    : mode === "login"
                      ? "로그인"
                      : mode === "signup"
                        ? "회원가입"
                        : "비밀번호 재설정 링크 보내기"}
                </Button>
              </form>

              {/* 모드 전환 */}
              <div className="flex flex-col items-center gap-1.5 text-center text-[14px] text-inv-body">
                {mode === "login" && (
                  <>
                    <p>
                      아직 계정이 없으신가요?{" "}
                      <button
                        onClick={() => { setMode("signup"); setError(""); setSuccess(""); setPassword(""); setPasswordConfirm(""); setTurnstileToken(""); setTouched({ name: false, email: false, password: false, passwordConfirm: false }); }}
                        className="font-medium text-inv-ink underline-offset-4 hover:underline"
                      >
                        회원가입
                      </button>
                    </p>
                    <p>
                      <button
                        onClick={() => { setMode("forgot"); setError(""); setSuccess(""); setPassword(""); setPasswordConfirm(""); setTurnstileToken(""); }}
                        className="text-inv-body transition-colors hover:text-inv-ink hover:underline"
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
                      className="font-medium text-inv-ink underline-offset-4 hover:underline"
                    >
                      로그인
                    </button>
                  </p>
                )}
                {mode === "forgot" && (
                  <p>
                    <button
                      onClick={() => { setMode("login"); setError(""); setSuccess(""); setPassword(""); setPasswordConfirm(""); setTurnstileToken(""); }}
                      className="font-medium text-inv-ink underline-offset-4 hover:underline"
                    >
                      ← 로그인으로 돌아가기
                    </button>
                  </p>
                )}
              </div>

              {/* 데모 체험 — 닫혀 있으면 구분선까지 함께 사라진다.
                  버튼만 지우면 "또는" 이 아무것도 잇지 않는 채로 남는다. */}
              {isPublicDemoTrialEnabled() && (
              <>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-inv-divider" />
                <span className="text-[12px] text-inv-muted">또는</span>
                <div className="h-px flex-1 bg-inv-divider" />
              </div>

              <button
                onClick={handleDemo}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-inv-chip-line bg-inv-white px-6 text-[14px] font-medium text-inv-ink transition-colors hover:bg-inv-stone"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
                </svg>
                로그인 없이 체험하기
              </button>

              <p className="text-center text-[12px] leading-5 text-inv-muted">
                체험 대화와 변경은 계정의 준비 기록에 남지 않아요. 체험 연결을 위한 임시 정보와 쿠키는 사용할 수 있어요.
              </p>
              </>
              )}
          </>

        {/* 하단 링크 */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-inv-divider pt-2">
          <Link href="/landing" className="inline-flex min-h-11 items-center text-[13px] text-inv-body transition-colors hover:text-inv-ink">
            ← 서비스 소개로
          </Link>
          {/* 계정을 만들기 전에 해볼 수 있는 것. 데모 체험과 달리 설정 플래그에 묶이지 않는다. */}
          <Link href="/wedding-code" className="inline-flex min-h-11 items-center text-[13px] font-medium text-inv-ink underline underline-offset-4 transition-colors hover:text-inv-muted">
            로그인 없이 웨딩코드 먼저 해보기
          </Link>
        </div>
    </InvitationAuthShell>
  );
}
