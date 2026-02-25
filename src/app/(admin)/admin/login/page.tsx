"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [adminSetupPw, setAdminSetupPw] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginSuccess, setLoginSuccess] = useState("");
  const [loginMode, setLoginMode] = useState<"login" | "signup">("login");
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) {
      setLoginError("이메일을 입력해주세요.");
      return;
    }
    setLoginLoading(true);
    setLoginError("");
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(loginEmail, {
        redirectTo: `${window.location.origin}/admin/login`,
      });
      if (resetError) {
        setLoginError(resetError.message);
      } else {
        setResetSent(true);
      }
    } catch {
      setLoginError("오류가 발생했습니다. 다시 시도해주세요.");
    }
    setLoginLoading(false);
  };

  const handleAdminAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword || !adminSetupPw) {
      setLoginError("모든 필드를 입력해주세요.");
      return;
    }
    if (loginMode === "signup" && loginPassword.length < 6) {
      setLoginError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    setLoginLoading(true);
    setLoginError("");
    setLoginSuccess("");

    try {
      if (loginMode === "signup") {
        const res = await fetch("/api/admin/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "signup",
            email: loginEmail,
            password: loginPassword,
            setupPassword: adminSetupPw,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          setLoginError(data.error || "계정 생성에 실패했습니다.");
          setLoginLoading(false);
          return;
        }

        const supabase = createClient();
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password: loginPassword,
        });

        if (signInError) {
          setLoginSuccess("계정이 생성되었습니다! 로그인 모드로 전환하여 로그인해주세요.");
          setLoginMode("login");
          setLoginLoading(false);
          return;
        }

        document.cookie = "onboarding_complete=true; path=/; max-age=2592000";
        document.cookie = "admin_role=true; path=/; max-age=2592000";
        window.location.href = "/admin";
      } else {
        const supabase = createClient();
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password: loginPassword,
        });

        if (signInError) {
          setLoginError(
            signInError.message === "Invalid login credentials"
              ? "이메일 또는 비밀번호가 올바르지 않습니다."
              : signInError.message
          );
          setLoginLoading(false);
          return;
        }

        const res = await fetch("/api/admin/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "login",
            email: loginEmail,
            password: loginPassword,
            setupPassword: adminSetupPw,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          setLoginError(data.error || "관리자 설정에 실패했습니다.");
          setLoginLoading(false);
          return;
        }

        document.cookie = "onboarding_complete=true; path=/; max-age=2592000";
        document.cookie = "admin_role=true; path=/; max-age=2592000";
        window.location.href = "/admin";
      }
    } catch {
      setLoginError("서버 오류가 발생했습니다.");
    }
    setLoginLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-noir-900 via-[#1a1520] to-noir-900 flex items-center justify-center px-5">
      {/* 배경 장식 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(201,169,110,0.1),transparent)] blur-[80px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(196,150,126,0.06),transparent)] blur-[80px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* 로고 영역 */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-gold to-rose-500 mb-4">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="font-serif-kr text-[22px] font-light text-white mb-2">
            웨딩한방 관리자
          </h1>
          <p className="text-[13px] text-white/50">
            관리자 전용 시스템
          </p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white/[0.06] backdrop-blur-[20px] rounded-3xl border border-white/[0.08] p-8">
          <h2 className="text-[18px] font-medium text-white text-center mb-1">
            {loginMode === "signup" ? "관리자 계정 생성" : "관리자 로그인"}
          </h2>
          <p className="text-[12px] text-white/40 text-center mb-8">
            {loginMode === "signup"
              ? "새 관리자 계정을 생성합니다"
              : "관리자 계정으로 로그인하세요"}
          </p>

          {resetMode ? (
            resetSent ? (
              <div className="text-center py-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-[#2E7D5A]/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-[24px]">✉️</span>
                </div>
                <p className="text-[14px] text-white font-medium mb-2">
                  비밀번호 재설정 메일을 보냈습니다
                </p>
                <p className="text-[12px] text-white/40 mb-6">
                  {loginEmail}로 발송된 메일을 확인해주세요.
                  <br />메일이 오지 않으면 스팸함도 확인해보세요.
                </p>
                <button
                  onClick={() => { setResetMode(false); setResetSent(false); setLoginError(""); }}
                  className="text-[13px] text-gold font-medium hover:text-gold/80 transition-colors"
                >
                  로그인으로 돌아가기
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-3 mb-4">
                <p className="text-[12px] text-white/50 px-1 mb-1">
                  가입하신 이메일을 입력하시면 비밀번호 재설정 링크를 보내드립니다.
                </p>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => { setLoginEmail(e.target.value); setLoginError(""); }}
                  placeholder="admin@hanbang.ai"
                  className="w-full px-5 py-3.5 rounded-xl border border-white/[0.1] bg-white/[0.06] text-[14px] text-white outline-none focus:border-gold transition-colors placeholder:text-white/30"
                />
                {loginError && <p className="text-[12px] text-rose-400 px-1">{loginError}</p>}
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full py-3.5 rounded-full text-[14px] font-medium transition-all bg-gradient-to-r from-gold to-rose-500 text-white hover:shadow-[0_4px_20px_rgba(201,169,110,0.3)] disabled:opacity-50"
                >
                  {loginLoading ? "발송 중..." : "재설정 메일 보내기"}
                </button>
                <button
                  type="button"
                  onClick={() => { setResetMode(false); setLoginError(""); }}
                  className="w-full text-[13px] text-white/40 hover:text-white/70 transition-colors py-2"
                >
                  로그인으로 돌아가기
                </button>
              </form>
            )
          ) : (
            <>
              <form onSubmit={handleAdminAuth} className="space-y-3 mb-4">
                <div>
                  <label className="block text-[12px] text-white/50 mb-1.5 px-1">이메일</label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => { setLoginEmail(e.target.value); setLoginError(""); }}
                    placeholder="admin@hanbang.ai"
                    className="w-full px-5 py-3.5 rounded-xl border border-white/[0.1] bg-white/[0.06] text-[14px] text-white outline-none focus:border-gold transition-colors placeholder:text-white/30"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-white/50 mb-1.5 px-1">비밀번호</label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => { setLoginPassword(e.target.value); setLoginError(""); }}
                    placeholder={loginMode === "signup" ? "6자 이상" : "비밀번호"}
                    className="w-full px-5 py-3.5 rounded-xl border border-white/[0.1] bg-white/[0.06] text-[14px] text-white outline-none focus:border-gold transition-colors placeholder:text-white/30"
                  />
                </div>

                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <Shield className="w-3.5 h-3.5 text-gold" />
                    <label className="text-[12px] text-gold font-medium">관리자 인증 비밀번호</label>
                  </div>
                  <input
                    type="password"
                    value={adminSetupPw}
                    onChange={(e) => { setAdminSetupPw(e.target.value); setLoginError(""); }}
                    placeholder="관리자 인증 비밀번호"
                    className="w-full px-5 py-3.5 rounded-xl border border-gold/30 bg-gold/[0.04] text-[14px] text-white outline-none focus:border-gold transition-colors placeholder:text-white/30"
                  />
                  <p className="text-[11px] text-white/30 mt-1 px-1">
                    환경변수 ADMIN_PASSWORD에 설정된 비밀번호
                  </p>
                </div>

                {loginError && (
                  <p className="text-[12px] text-rose-400 px-1">{loginError}</p>
                )}
                {loginSuccess && (
                  <p className="text-[12px] text-[#4ADE80] px-1">{loginSuccess}</p>
                )}

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full py-3.5 rounded-full text-[14px] font-medium transition-all bg-gradient-to-r from-gold to-rose-500 text-white hover:shadow-[0_4px_20px_rgba(201,169,110,0.3)] disabled:opacity-50 mt-2"
                >
                  {loginLoading
                    ? "처리 중..."
                    : loginMode === "signup"
                      ? "관리자 계정 생성"
                      : "로그인"}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setResetMode(true); setLoginError(""); setLoginSuccess(""); }}
                    className="text-[12px] text-white/40 hover:text-white/60 transition-colors"
                  >
                    비밀번호를 잊으셨나요?
                  </button>
                </div>
              </form>

              {/* 모드 전환 */}
              <p className="text-[13px] text-white/40 text-center">
                {loginMode === "signup" ? (
                  <>
                    이미 계정이 있으신가요?{" "}
                    <button
                      onClick={() => { setLoginMode("login"); setLoginError(""); setLoginSuccess(""); }}
                      className="text-gold font-medium hover:underline"
                    >
                      로그인
                    </button>
                  </>
                ) : (
                  <>
                    계정이 없으신가요?{" "}
                    <button
                      onClick={() => { setLoginMode("signup"); setLoginError(""); setLoginSuccess(""); }}
                      className="text-gold font-medium hover:underline"
                    >
                      계정 생성
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>

        {/* 하단 링크 */}
        <div className="flex items-center justify-center gap-6 mt-6">
          <a
            href="/"
            className="text-[13px] text-white/40 hover:text-white/70 transition-colors"
          >
            ← 홈으로
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
