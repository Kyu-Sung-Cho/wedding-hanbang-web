'use client';

import { motion } from 'framer-motion';
import Logo from '@/components/ui/Logo';

interface IntroScreenProps {
  onStart: () => void;
  hasDraft: boolean;
  onResume: () => void;
  onDismissDraft: () => void;
}

export default function IntroScreen({
  onStart,
  hasDraft,
  onResume,
  onDismissDraft,
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
        <p className="text-[38px] text-taupe-500 leading-relaxed mb-3">
          수도권 예비부부 및 신혼부부의 결혼 준비 경험에 대한 설문입니다.
          <br />
          소요 시간은 약 5~7분이며, 응답 내용은 서비스 개선에만 활용됩니다.
        </p>
        <p className="text-[25px] text-taupe-400 mb-10">
          모든 응답은 익명으로 처리됩니다.
        </p>

        {hasDraft ? (
          <div className="space-y-3">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="p-4 rounded-2xl bg-[var(--rose-glow)] border border-rose-pale mb-4"
            >
              <p className="text-[23px] text-noir-800">
                이전에 작성 중이던 응답이 있습니다.
              </p>
            </motion.div>
            <button
              type="button"
              onClick={onResume}
              className="w-full py-4 rounded-2xl bg-noir-800 text-white text-[38px] font-medium hover:bg-noir-900 hover:shadow-[0_4px_20px_rgba(13,13,15,0.2)] transition-all active:scale-[0.98]"
            >
              이어서 작성하기
            </button>
            <button
              type="button"
              onClick={() => {
                onDismissDraft();
                onStart();
              }}
              className="w-full py-4 rounded-2xl border-[1.5px] border-platinum text-[38px] font-medium text-charcoal hover:bg-ivory-warm hover:border-rose-pale transition-all"
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
            className="w-full max-w-xs mx-auto py-4 rounded-2xl bg-noir-800 text-white text-[38px] font-medium hover:bg-noir-900 hover:shadow-[0_4px_20px_rgba(13,13,15,0.2)] transition-all active:scale-[0.98]"
          >
            설문 시작하기
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
