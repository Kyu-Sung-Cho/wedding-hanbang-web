"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Bell, Check, AlertTriangle, Info } from "lucide-react";
import type { ComputedNotification } from "@/hooks/useNotifications";

const PRIORITY_STYLES: Record<string, { icon: React.ElementType; accent: string; bg: string }> = {
  high: { icon: AlertTriangle, accent: "text-red-500", bg: "bg-red-50" },
  medium: { icon: Bell, accent: "text-[#C4967E]", bg: "bg-[#C4967E]/5" },
  low: { icon: Info, accent: "text-[#928980]", bg: "bg-[#FAF8F5]" },
};

interface Props {
  notifications: ComputedNotification[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onCategoryClick: (categoryKey: string) => void;
  onClose: () => void;
}

export default function NotificationPanel({
  notifications,
  onDismiss,
  onDismissAll,
  onCategoryClick,
  onClose,
}: Props) {
  return (
    <>
      {/* 오버레이 */}
      <div onClick={onClose} className="fixed inset-0 z-40" />

      {/* 패널 */}
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.97 }}
        transition={{ duration: 0.2 }}
        className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] bg-white rounded-2xl border border-black/[0.06] shadow-xl z-50 overflow-hidden flex flex-col max-md:w-[calc(100vw-32px)] max-md:right-[-8px]"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.04]">
          <h3 className="text-[23px] font-medium text-[#1A1A1F]">알림</h3>
          <div className="flex items-center gap-2">
            {notifications.length > 0 && (
              <button
                onClick={onDismissAll}
                className="text-[27px] text-[#928980] hover:text-[#C4967E] transition-colors"
              >
                모두 읽음
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#FAF8F5] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 알림 목록 */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6">
              <div className="w-12 h-12 rounded-full bg-[#2E7D5A]/10 flex items-center justify-center mb-3">
                <Check className="w-6 h-6 text-[#2E7D5A]" />
              </div>
              <p className="text-[53px] text-[#928980] font-medium">
                모든 알림을 확인했습니다
              </p>
              <p className="text-[47px] text-[#B5ADA3] mt-1">
                새로운 알림이 오면 여기에 표시됩니다
              </p>
            </div>
          ) : (
            <div className="py-2">
              <AnimatePresence>
                {notifications.map((n) => {
                  const style = PRIORITY_STYLES[n.priority] ?? PRIORITY_STYLES.low;
                  const Icon = style.icon;

                  return (
                    <motion.div
                      key={n.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className={`px-5 py-3 hover:bg-[#FDFCFA] transition-colors ${
                        n.isNew ? "" : "opacity-60"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg ${style.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}
                        >
                          <Icon className={`w-4 h-4 ${style.accent}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[31px] font-medium text-[#1A1A1F]">
                              {n.title}
                            </p>
                            {n.isNew && (
                              <div className="w-1.5 h-1.5 rounded-full bg-[#C4967E] flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-[47px] text-[#928980] font-light mt-0.5 leading-relaxed">
                            {n.message}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            {n.categoryKey && (
                              <button
                                onClick={() => onCategoryClick(n.categoryKey!)}
                                className="text-[27px] text-[#C4967E] hover:underline"
                              >
                                체크리스트 보기
                              </button>
                            )}
                            {n.isNew && (
                              <button
                                onClick={() => onDismiss(n.id)}
                                className="text-[27px] text-[#B5ADA3] hover:text-[#928980]"
                              >
                                읽음
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
