'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export default function ThankYou() {
  return (
    <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center max-w-md"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
          className="w-20 h-20 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center mx-auto mb-6"
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>
        <h2 className="text-[45px] font-serif-kr font-medium text-noir-800 mb-3">
          소중한 응답 감사합니다
        </h2>
        <p className="text-[21px] text-taupe-500 leading-relaxed mb-4">
          응답해 주신 내용은 더 나은 결혼 준비 서비스를 만드는 데 큰 도움이 됩니다.
        </p>
        <p className="text-[23px] text-rose-500 font-medium mb-8">
          웨딩한방이 여러분의 행복한 결혼 준비를 함께하겠습니다.
        </p>
        <Link
          href="/"
          className="inline-block px-8 py-3.5 rounded-2xl bg-noir-800 text-white text-[21px] font-medium hover:bg-noir-900 hover:shadow-[0_4px_20px_rgba(13,13,15,0.2)] transition-all"
        >
          웨딩한방 알아보기
        </Link>
      </motion.div>
    </div>
  );
}
