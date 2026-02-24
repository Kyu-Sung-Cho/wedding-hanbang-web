"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Building2, ArrowLeft } from "lucide-react";

export default function VendorLoginPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleOAuth = async (provider: "kakao" | "google") => {
    setLoading(provider);
    setError("");
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?from=vendor`,
        },
      });
      if (oauthError) {
        setError(`로그인 오류: ${oauthError.message}`);
        setLoading(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoading(null);
      setError(`로그인 실패: ${msg}`);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    setLoading("email");
    setError("");

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "이메일 또는 비밀번호가 올바르지 않습니다."
            : signInError.message
        );
        setLoading(null);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("로그인 처리 중 오류가 발생했습니다.");
        setLoading(null);
        return;
      }

      // 업체 레코드 확인
      const { data: vendorRecord } = await supabase
        .from("vendors")
        .select("id, status")
        .eq("owner_id", user.id)
        .maybeSingle();

      if (vendorRecord) {
        document.cookie = "onboarding_complete=true; path=/; max-age=2592000";
        document.cookie = "vendor_role=true; path=/; max-age=2592000";
        window.location.href = "/vendor/dashboard";
      } else {
        // 업체 등록 안 되어 있으면 등록 페이지로
        document.cookie = "onboarding_complete=true; path=/; max-age=2592000";
        window.location.href = "/vendor/register";
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`오류: ${msg}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-noir-900 via-noir-800 to-noir-900 flex items-center justify-center px-5">
      {/* 배경 장식 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(196,150,126,0.08),transparent)] blur-[80px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(201,169,110,0.06),transparent)] blur-[80px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* 로고 영역 */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-gold mb-4">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="font-serif-kr text-[22px] font-light text-white mb-2">
            웨딩한방 업체 포털
          </h1>
          <p className="text-[13px] text-white/50">
            파트너 업체 전용 관리 시스템
          </p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white/[0.06] backdrop-blur-[20px] rounded-3xl border border-white/[0.08] p-8">
          <h2 className="text-[18px] font-medium text-white text-center mb-1">
            업체 로그인
          </h2>
          <p className="text-[12px] text-white/40 text-center mb-8">
            등록된 업체 계정으로 로그인하세요
          </p>

          {/* 이메일 폼 */}
          <form onSubmit={handleEmailLogin} className="space-y-3 mb-6">
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              placeholder="업체 이메일"
              className="w-full px-5 py-3.5 rounded-xl border border-white/[0.1] bg-white/[0.06] text-[14px] text-white outline-none focus:border-rose-500 transition-colors placeholder:text-white/30"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder="비밀번호"
              className="w-full px-5 py-3.5 rounded-xl border border-white/[0.1] bg-white/[0.06] text-[14px] text-white outline-none focus:border-rose-500 transition-colors placeholder:text-white/30"
            />

            {error && (
              <p className="text-[12px] text-rose-400 px-1">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading !== null}
              className="w-full py-3.5 rounded-full text-[14px] font-medium transition-all bg-gradient-to-r from-rose-500 to-gold text-white hover:shadow-[0_4px_20px_rgba(196,150,126,0.3)] disabled:opacity-50"
            >
              {loading === "email" ? "로그인 중..." : "로그인"}
            </button>
          </form>

          {/* 구분선 */}
          <div className="flex items-center gap-4 mb-5">
            <div className="flex-1 h-px bg-white/[0.1]" />
            <span className="text-[11px] text-white/30">소셜 계정으로 로그인</span>
            <div className="flex-1 h-px bg-white/[0.1]" />
          </div>

          {/* 소셜 로그인 */}
          <div className="flex gap-3 mb-6">
            <button
              onClick={() => handleOAuth("kakao")}
              disabled={loading !== null}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-medium transition-all bg-[#FEE500] text-[#191919] hover:shadow-[0_4px_16px_rgba(254,229,0,0.2)]"
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path
                  d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.63 5.18l-.93 3.44c-.08.3.26.54.52.37l4.1-2.72c.22.02.44.03.68.03 4.42 0 8-2.79 8-6.3C17 3.79 13.42 1 9 1z"
                  fill="#191919"
                />
              </svg>
              카카오
            </button>
            <button
              onClick={() => handleOAuth("google")}
              disabled={loading !== null}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-medium transition-all bg-white/[0.1] border border-white/[0.1] text-white hover:bg-white/[0.15]"
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path
                  d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92a8.78 8.78 0 002.68-6.62z"
                  fill="#4285F4"
                />
                <path
                  d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z"
                  fill="#34A853"
                />
                <path
                  d="M3.97 10.71A5.41 5.41 0 013.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.33z"
                  fill="#FBBC05"
                />
                <path
                  d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96l3.01 2.33C4.68 5.17 6.66 3.58 9 3.58z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </button>
          </div>

          {/* 업체 등록 안내 */}
          <div className="bg-white/[0.04] rounded-xl p-4 text-center">
            <p className="text-[12px] text-white/40 mb-2">
              아직 업체 등록을 안 하셨나요?
            </p>
            <a
              href="/vendor/register"
              className="text-[13px] text-rose-400 font-medium hover:text-rose-300 transition-colors"
            >
              업체 등록 신청하기 →
            </a>
          </div>
        </div>

        {/* 하단 링크 */}
        <div className="flex items-center justify-center gap-6 mt-6">
          <a
            href="/vendor/service"
            className="inline-flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            업체 서비스 안내
          </a>
          <span className="text-white/10">|</span>
          <a
            href="/login"
            className="text-[13px] text-white/40 hover:text-white/70 transition-colors"
          >
            고객 로그인
          </a>
        </div>
      </motion.div>
    </div>
  );
}
