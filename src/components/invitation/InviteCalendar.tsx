"use client";

import { motion } from "framer-motion";
import type { Invitation } from "@/types/invitation.types";

interface Props {
  invitation: Invitation;
  colors: string[];
  fonts: { heading: string; body: string };
}

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

export default function InviteCalendar({ invitation, colors, fonts }: Props) {
  if (!invitation.wedding_date) return null;
  const date = new Date(invitation.wedding_date);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // 해당 월 달력 계산
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  // D-day 계산
  const now = new Date();
  const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <section className="py-12 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <h3 className="text-[11px] tracking-[0.2em] uppercase mb-6" style={{ color: colors[0] }}>
          Calendar
        </h3>

        <p
          className="text-[16px] font-light mb-4"
          style={{ fontFamily: `'${fonts.heading}', serif` }}
        >
          {year}년 {month + 1}월
        </p>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {DAYS.map((d) => (
            <div key={d} className="text-[11px] font-medium opacity-40 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* 날짜 그리드 */}
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((d, i) => (
            <div
              key={i}
              className={`text-[13px] py-2 rounded-full ${
                d === day ? "font-bold text-white" : d ? "opacity-60" : ""
              }`}
              style={d === day ? { background: colors[0] } : undefined}
            >
              {d ?? ""}
            </div>
          ))}
        </div>

        {/* D-day */}
        {diff > 0 && (
          <p className="mt-4 text-[13px]" style={{ color: colors[0] }}>
            결혼식까지 <span className="font-semibold">{diff}</span>일
          </p>
        )}
      </motion.div>
    </section>
  );
}
