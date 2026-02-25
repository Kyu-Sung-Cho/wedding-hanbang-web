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
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("이메일을 입력해주세요.");
      return;
    }
    setLoading("reset");
    setError("");
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/vendor/login`,
      });
      if (resetError) {
        setError(resetError.message);
      } else {
        setResetSent(true);
      }
    } catch {
      setError("오류가 발생했습니다. 다시 시도해주세요.");
    }
    setLoading(null);
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

          {resetMode ? (
            resetSent ? (
              <div className="text-center py-4 mb-6">
                <div className="w-12 h-12 rounded-full bg-[#2E7D5A]/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-[24px]">✉️</span>
                </div>
                <p className="text-[14px] text-white font-medium mb-2">
                  비밀번호 재설정 메일을 보냈습니다
                </p>
                <p className="text-[12px] text-white/40 mb-6">
                  {email}로 발송된 메일을 확인해주세요.
                  <br />메일이 오지 않으면 스팸함도 확인해보세요.
                </p>
                <button
                  onClick={() => { setResetMode(false); setResetSent(false); setError(""); }}
                  className="text-[13px] text-rose-400 font-medium hover:text-rose-300 transition-colors"
                >
                  로그인으로 돌아가기
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-3 mb-6">
                <p className="text-[12px] text-white/50 px-1 mb-1">
                  가입하신 이메일을 입력하시면 비밀번호 재설정 링크를 보내드립니다.
                </p>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="업체 이메일"
                  className="w-full px-5 py-3.5 rounded-xl border border-white/[0.1] bg-white/[0.06] text-[14px] text-white outline-none focus:border-rose-500 transition-colors placeholder:text-white/30"
                />
                {error && <p className="text-[12px] text-rose-400 px-1">{error}</p>}
                <button
                  type="submit"
                  disabled={loading !== null}
                  className="w-full py-3.5 rounded-full text-[14px] font-medium transition-all bg-gradient-to-r from-rose-500 to-gold text-white hover:shadow-[0_4px_20px_rgba(196,150,126,0.3)] disabled:opacity-50"
                >
                  {loading === "reset" ? "발송 중..." : "재설정 메일 보내기"}
                </button>
                <button
                  type="button"
                  onClick={() => { setResetMode(false); setError(""); }}
                  className="w-full text-[13px] text-white/40 hover:text-white/70 transition-colors py-2"
                >
                  로그인으로 돌아가기
                </button>
              </form>
            )
          ) : (
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

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setResetMode(true); setError(""); }}
                  className="text-[12px] text-white/40 hover:text-white/60 transition-colors"
                >
                  비밀번호를 잊으셨나요?
                </button>
              </div>
            </form>
          )}

          {/* 업체 등록 안내 */}
          <div className="bg-white/[0.04] rounded-xl p-4 text-center">
            <p className="text-[12px] text-white/40 mb-2">
              아직 계정이 없으신가요?
            </p>
            <a
              href="/vendor/register"
              className="text-[13px] text-rose-400 font-medium hover:text-rose-300 transition-colors"
            >
              회원가입 + 업체 등록하기 →
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
