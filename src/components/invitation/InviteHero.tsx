"use client";

import { motion } from "framer-motion";
import type { Invitation } from "@/types/invitation.types";

interface Props {
  invitation: Invitation;
  colors: string[];
  fonts: { heading: string; body: string };
}

export default function InviteHero({ invitation, colors, fonts }: Props) {
  const weddingDate = invitation.wedding_date
    ? new Date(invitation.wedding_date)
    : null;

  return (
    <section className="relative py-16 px-6 text-center overflow-hidden">
      {/* 배경 장식 */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          background: `radial-gradient(circle at 30% 20%, ${colors[0]}, transparent 60%), radial-gradient(circle at 70% 80%, ${colors[0]}, transparent 60%)`,
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative z-10"
      >
        <p className="text-[11px] tracking-[0.3em] uppercase mb-6" style={{ color: colors[0] }}>
          Wedding Invitation
        </p>

        <h1
          className="text-[28px] font-light leading-[1.4] mb-4"
          style={{ fontFamily: `'${fonts.heading}', serif`, color: colors[2] }}
        >
          {invitation.groom_name} <span style={{ color: colors[0] }}>&</span> {invitation.bride_name}
        </h1>

        {weddingDate && (
          <p className="text-[14px] tracking-wide" style={{ color: colors[0] }}>
            {weddingDate.getFullYear()}.
            {String(weddingDate.getMonth() + 1).padStart(2, "0")}.
            {String(weddingDate.getDate()).padStart(2, "0")}
            {" "}
            {["일", "월", "화", "수", "목", "금", "토"][weddingDate.getDay()]}요일
            {" "}
            {weddingDate.getHours() < 12 ? "오전" : "오후"}
            {" "}
            {weddingDate.getHours() > 12 ? weddingDate.getHours() - 12 : weddingDate.getHours()}시
          </p>
        )}

        {invitation.wedding_venue && (
          <p className="text-[13px] mt-2 opacity-60">
            {invitation.wedding_venue}
            {invitation.wedding_hall ? ` ${invitation.wedding_hall}` : ""}
          </p>
        )}
      </motion.div>
    </section>
  );
}
