"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-ivory-50"><div className="h-8 w-8 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" /></div>}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";
  const callbackError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    callbackError === "exchange_failed"
      ? "로그인 처리에 실패했습니다. 다시 시도해주세요."
      : callbackError === "no_code"
        ? "인증 코드를 받지 못했습니다."
        : callbackError
          ? "로그인에 실패했습니다."
          : ""
  );

  const handleEmailLogin = async () => {
    const supabase = createClient();
    if (!email || !password) return;
    setLoading(true);
    setError("");

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      setLoading(false);
      return;
    }

    router.push(redirect);
  };

  const handleSocialLogin = async (provider: "google" | "kakao") => {
    const supabase = createClient();
    setLoading(true);
    setError("");

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?redirect=${encodeURIComponent(redirect)}`,
      },
    });

    if (authError) {
      console.error("OAuth error:", authError);
      setError("소셜 로그인에 실패했습니다.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-ivory-50 to-ivory-warm px-5">
      <div className="w-full max-w-[420px]">
        {/* 로고 */}
        <div className="mb-10 text-center">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-gold text-lg font-semibold text-white font-display">
              한
            </div>
            <span className="text-xl font-medium font-serif tracking-[-0.5px] text-noir-800">
              웨딩한방
            </span>
          </Link>
          <p className="mt-3 text-sm text-taupe-500">
            AI 웨딩 플래너와 함께 결혼 준비를 시작하세요
          </p>
        </div>

        {/* 소셜 로그인 */}
        <div className="mb-6 flex flex-col gap-3">
          <button
            onClick={() => handleSocialLogin("kakao")}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#FEE500] py-3.5 text-sm font-medium text-[#191919] transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#191919">
              <path d="M12 3C6.5 3 2 6.58 2 11c0 2.87 1.89 5.38 4.73 6.82-.2.75-.73 2.72-.84 3.14-.13.52.19.51.4.37.17-.11 2.63-1.79 3.7-2.52.64.09 1.31.14 2.01.14 5.5 0 10-3.58 10-8S17.5 3 12 3z" />
            </svg>
            카카오로 시작하기
          </button>
          <button
            onClick={() => handleSocialLogin("google")}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-platinum bg-white py-3.5 text-sm font-medium text-noir-800 transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Google로 시작하기
          </button>
        </div>

        {/* 구분선 */}
        <div className="mb-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-platinum" />
          <span className="text-xs text-taupe-500">또는 이메일로 로그인</span>
          <div className="h-px flex-1 bg-platinum" />
        </div>

        {/* 이메일 로그인 */}
        <div className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            className="w-full rounded-xl border border-platinum bg-white px-4 py-3.5 text-sm text-noir-800 outline-none transition-colors placeholder:text-taupe-light focus:border-rose-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEmailLogin()}
            placeholder="비밀번호"
            className="w-full rounded-xl border border-platinum bg-white px-4 py-3.5 text-sm text-noir-800 outline-none transition-colors placeholder:text-taupe-light focus:border-rose-500"
          />

          {error && (
            <p className="text-center text-sm text-red-500">{error}</p>
          )}

          <button
            onClick={handleEmailLogin}
            disabled={loading}
            className="w-full rounded-xl bg-noir-800 py-3.5 text-sm font-medium text-white transition-all hover:bg-noir-soft disabled:opacity-50"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-taupe-500">
          아직 계정이 없으신가요?{" "}
          <Link href="/signup" className="font-medium text-rose-500 hover:underline">
            회원가입
          </Link>
        </p>
      </div>
    </div>
  );
}
