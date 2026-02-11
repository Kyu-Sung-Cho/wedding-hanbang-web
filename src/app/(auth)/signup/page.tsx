"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignup = async () => {
    const supabase = createClient();
    if (!email || !password || !displayName) {
      setError("모든 항목을 입력해주세요.");
      return;
    }
    if (password !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    setLoading(true);
    setError("");

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
      },
    });

    if (authError) {
      setError(authError.message === "User already registered"
        ? "이미 가입된 이메일입니다."
        : "회원가입에 실패했습니다.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  };

  const handleSocialLogin = async (provider: "google" | "kakao") => {
    const supabase = createClient();
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/callback?redirect=/dashboard`,
      },
    });
    if (authError) {
      setError("소셜 로그인에 실패했습니다.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-ivory-50 to-ivory-warm px-5">
      <div className="w-full max-w-[420px]">
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
            새 계정을 만들고 결혼 준비를 시작하세요
          </p>
        </div>

        {/* 소셜 */}
        <div className="mb-6 flex flex-col gap-3">
          <button
            onClick={() => handleSocialLogin("kakao")}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#FEE500] py-3.5 text-sm font-medium text-[#191919] transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-50"
          >
            카카오로 시작하기
          </button>
          <button
            onClick={() => handleSocialLogin("google")}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-platinum bg-white py-3.5 text-sm font-medium text-noir-800 transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-50"
          >
            Google로 시작하기
          </button>
        </div>

        <div className="mb-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-platinum" />
          <span className="text-xs text-taupe-500">또는 이메일로 가입</span>
          <div className="h-px flex-1 bg-platinum" />
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="이름"
            className="w-full rounded-xl border border-platinum bg-white px-4 py-3.5 text-sm text-noir-800 outline-none transition-colors placeholder:text-taupe-light focus:border-rose-500"
          />
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
            placeholder="비밀번호 (6자 이상)"
            className="w-full rounded-xl border border-platinum bg-white px-4 py-3.5 text-sm text-noir-800 outline-none transition-colors placeholder:text-taupe-light focus:border-rose-500"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSignup()}
            placeholder="비밀번호 확인"
            className="w-full rounded-xl border border-platinum bg-white px-4 py-3.5 text-sm text-noir-800 outline-none transition-colors placeholder:text-taupe-light focus:border-rose-500"
          />

          {error && <p className="text-center text-sm text-red-500">{error}</p>}

          <button
            onClick={handleSignup}
            disabled={loading}
            className="w-full rounded-xl bg-noir-800 py-3.5 text-sm font-medium text-white transition-all hover:bg-noir-soft disabled:opacity-50"
          >
            {loading ? "가입 중..." : "회원가입"}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-taupe-500">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="font-medium text-rose-500 hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
