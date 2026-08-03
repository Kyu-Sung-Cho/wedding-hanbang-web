'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Logo from '@/components/ui/Logo';

interface IntroScreenProps {
  onStart: () => void;
  hasDraft: boolean;
  onResume: () => void;
  onDismissDraft: () => void;
  consent: boolean;
  onConsentChange: (consent: boolean) => void;
}

export default function IntroScreen({
  onStart,
  hasDraft,
  onResume,
  onDismissDraft,
  consent,
  onConsentChange,
}: IntroScreenProps) {
  return (
    <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center max-w-lg"
      >
        {/* 로고 */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="flex justify-center mb-8"
        >
          <Logo size="md" />
        </motion.div>

        <h1 className="text-[clamp(26px,5vw,36px)] font-serif-kr font-medium text-noir-800 mb-4 leading-tight">
          결혼 준비 경험 설문조사
        </h1>
        <p className="text-[15px] text-taupe-500 leading-relaxed mb-3">
          수도권 예비부부 및 신혼부부의 결혼 준비 경험에 대한 설문입니다.
          <br />
          소요 시간은 약 5~7분이며, 응답 내용은 서비스 개선에만 활용됩니다.
        </p>
        <p className="text-[13px] text-taupe-400 mb-10">
          이름·연락처와 자유서술은 수집하지 않고 선택형 응답만 처리합니다.
        </p>

        <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-platinum bg-white px-4 py-4 text-left">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => onConsentChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#36534E]"
          />
          <span className="text-[13px] leading-relaxed text-charcoal">
            익명 설문 응답(성별·연령대·예산 구간 및 선택형 응답)을 서비스 개선을 위해 처리하는 데 동의합니다.{' '}
            <Link href="/privacy" className="font-medium text-[#36534E] underline underline-offset-2">
              개인정보 처리방침
            </Link>
          </span>
        </label>

        {hasDraft ? (
          <div className="space-y-3">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="p-4 rounded-2xl bg-[var(--rose-glow)] border border-rose-pale mb-4"
            >
              <p className="text-[14px] text-noir-800">
                이전에 작성 중이던 응답이 있습니다.
              </p>
            </motion.div>
            <button
              type="button"
              onClick={onResume}
              disabled={!consent}
              className="w-full py-4 rounded-2xl bg-noir-800 text-white text-[15px] font-medium hover:bg-noir-900 hover:shadow-[0_4px_20px_rgba(13,13,15,0.2)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              이어서 작성하기
            </button>
            <button
              type="button"
              onClick={() => {
                onDismissDraft();
                onStart();
              }}
              disabled={!consent}
              className="w-full py-4 rounded-2xl border-[1.5px] border-platinum text-[15px] font-medium text-charcoal hover:bg-ivory-warm hover:border-rose-pale transition-all disabled:cursor-not-allowed disabled:opacity-40"
            >
              처음부터 시작하기
            </button>
          </div>
        ) : (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            type="button"
            onClick={onStart}
            disabled={!consent}
            className="w-full max-w-xs mx-auto py-4 rounded-2xl bg-noir-800 text-white text-[15px] font-medium hover:bg-noir-900 hover:shadow-[0_4px_20px_rgba(13,13,15,0.2)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            설문 시작하기
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
