"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Logo from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleOAuth = async (provider: "kakao" | "google") => {
    setLoading(provider);
    setError("");
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
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
    if (!email || !password) {
      setError("이메일과 비밀번호를 입력해주세요.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    setLoading("email");
    setError("");
    setSuccess("");

    try {
      const supabase = createClient();

      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
            emailRedirectTo: `${window.location.origin}/api/auth/callback`,
          },
        });
        if (signUpError) {
          setError(signUpError.message === "User already registered"
            ? "이미 가입된 이메일입니다. 로그인해주세요."
            : signUpError.message);
        } else {
          setSuccess("확인 이메일을 보냈습니다. 메일함을 확인해주세요!");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          setError(signInError.message === "Invalid login credentials"
            ? "이메일 또는 비밀번호가 올바르지 않습니다."
            : signInError.message);
        } else {
          // 온보딩 완료 여부 확인
          const { data: { user: loggedInUser } } = await supabase.auth.getUser();
          if (loggedInUser) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("onboarding_completed")
              .eq("id", loggedInUser.id)
              .single();

            if (profile?.onboarding_completed) {
              document.cookie = "onboarding_complete=true; path=/; max-age=2592000";
              window.location.href = "/dashboard";
            } else {
              window.location.href = "/onboarding";
            }
          } else {
            window.location.href = "/dashboard";
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Auth error:", msg);
      setError(`오류: ${msg}`);
    } finally {
      setLoading(null);
    }
  };

  const handleDemo = () => {
    document.cookie = "demo_mode=true; path=/; max-age=86400";
    window.location.href = "/dashboard";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep flex items-center justify-center px-5">
      {/* 배경 장식 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -right-[5%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,var(--rose-pale),transparent)] blur-[100px] opacity-25" />
        <div className="absolute -bottom-[10%] -left-[5%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,var(--gold-light),transparent)] blur-[100px] opacity-25" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* 로고 */}
        <div className="text-center mb-10">
          <a href="/">
            <Logo size="md" />
          </a>
          <p className="text-[14px] text-taupe-500 font-light mt-3">
            AI 웨딩 플래너와 함께하는 결혼 준비
          </p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
          <h1 className="font-serif-kr text-[24px] font-light text-noir-800 text-center mb-2">
            {mode === "login" ? "로그인" : "회원가입"}
          </h1>
          <p className="text-[13px] text-taupe-400 text-center mb-8">
            {mode === "login"
              ? "계정에 로그인하세요"
              : "이메일로 간편하게 가입하세요"}
          </p>

          {/* 이메일 폼 */}
          <form onSubmit={handleEmailAuth} className="space-y-3 mb-4">
            {mode === "signup" && (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                className="w-full px-5 py-3.5 rounded-2xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
              />
            )}
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="이메일"
              className="w-full px-5 py-3.5 rounded-2xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="비밀번호"
              className="w-full px-5 py-3.5 rounded-2xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
            />

            {error && (
              <p className="text-[12px] text-rose-600 px-1">{error}</p>
            )}
            {success && (
              <p className="text-[12px] text-[#2E7D5A] px-1">{success}</p>
            )}

            <button
              type="submit"
              disabled={loading !== null}
              className="w-full py-3.5 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 bg-noir-800 text-white hover:bg-noir-soft hover:shadow-[0_4px_16px_rgba(26,26,31,0.15)]"
            >
              {loading === "email"
                ? "처리 중..."
                : mode === "login"
                  ? "로그인"
                  : "회원가입"}
            </button>
          </form>

          {/* 모드 전환 */}
          <p className="text-[13px] text-taupe-400 text-center mb-6">
            {mode === "login" ? (
              <>
                아직 계정이 없으신가요?{" "}
                <button
                  onClick={() => { setMode("signup"); setError(""); setSuccess(""); }}
                  className="text-rose-500 font-medium hover:underline"
                >
                  회원가입
                </button>
              </>
            ) : (
              <>
                이미 계정이 있으신가요?{" "}
                <button
                  onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
                  className="text-rose-500 font-medium hover:underline"
                >
                  로그인
                </button>
              </>
            )}
          </p>

          {/* 구분선 */}
          <div className="flex items-center gap-4 mb-5">
            <div className="flex-1 h-px bg-platinum" />
            <span className="text-[11px] text-taupe-400">소셜 로그인</span>
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
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-medium transition-all hover:-translate-y-0.5 bg-white border border-black/[0.08] text-noir-800 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92a8.78 8.78 0 002.68-6.62z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" fill="#34A853"/>
                <path d="M3.97 10.71A5.41 5.41 0 013.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" fill="#FBBC05"/>
                <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96l3.01 2.33C4.68 5.17 6.66 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Google
            </button>
          </div>

          {/* 구분선 */}
          <div className="flex items-center gap-4 mb-5">
            <div className="flex-1 h-px bg-platinum" />
            <span className="text-[11px] text-taupe-400">또는</span>
            <div className="flex-1 h-px bg-platinum" />
          </div>

          {/* 데모 체험 */}
          <button
            onClick={handleDemo}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl text-[14px] font-medium transition-all hover:-translate-y-0.5 border-[1.5px] border-rose-500 text-rose-500 hover:bg-rose-500/5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
            </svg>
            로그인 없이 체험하기
          </button>

          <p className="text-[11px] text-taupe-400 text-center mt-4 font-light">
            체험 모드에서는 모든 기능을 미리 둘러볼 수 있습니다
          </p>
        </div>

        {/* 하단 링크 */}
        <div className="text-center mt-6">
          <a href="/" className="text-[13px] text-taupe-400 hover:text-rose-500 transition-colors">
            ← 홈으로 돌아가기
          </a>
        </div>
      </motion.div>
    </div>
  );
}
