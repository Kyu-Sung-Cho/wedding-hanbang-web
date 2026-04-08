'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export default function ScreenOut() {
  return (
    <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center max-w-md"
      >
        <div className="w-20 h-20 rounded-full bg-ivory-200 flex items-center justify-center mx-auto mb-6">
          <span className="text-[32px]">🙏</span>
        </div>
        <h2 className="text-[24px] font-serif-kr font-medium text-noir-800 mb-3">
          설문에 참여해 주셔서 감사합니다
        </h2>
        <p className="text-[15px] text-taupe-500 leading-relaxed mb-8">
          본 설문은 수도권에서 결혼을 준비 중이거나 최근 결혼을 완료한 분들을 대상으로 진행하고 있습니다.
          <br />
          다음에 또 만나뵐 수 있기를 바랍니다.
        </p>
        <Link
          href="/"
          className="inline-block px-8 py-3.5 rounded-2xl bg-noir-800 text-white text-[15px] font-medium hover:bg-noir-900 transition-colors"
        >
          홈으로 돌아가기
        </Link>
      </motion.div>
    </div>
  );
}
