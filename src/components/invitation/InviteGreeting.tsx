"use client";

import { motion } from "framer-motion";
import type { Invitation } from "@/types/invitation.types";

interface Props {
  invitation: Invitation;
  colors: string[];
  fonts: { heading: string; body: string };
}

export default function InviteGreeting({ invitation, colors, fonts }: Props) {
  if (!invitation.greeting_message) return null;

  return (
    <section className="py-12 px-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        {/* 장식선 */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-8 h-px" style={{ background: colors[0] }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: colors[0] }} />
          <div className="w-8 h-px" style={{ background: colors[0] }} />
        </div>

        <h2
          className="text-[18px] font-light mb-6"
          style={{ fontFamily: `'${fonts.heading}', serif`, color: colors[2] }}
        >
          {invitation.greeting_title}
        </h2>

        <p
          className="text-[14px] leading-[2] whitespace-pre-line opacity-70"
          style={{ fontFamily: `'${fonts.body}', sans-serif` }}
        >
          {invitation.greeting_message}
        </p>

        {/* 장식선 */}
        <div className="flex items-center justify-center gap-3 mt-6">
          <div className="w-8 h-px" style={{ background: colors[0] }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: colors[0] }} />
          <div className="w-8 h-px" style={{ background: colors[0] }} />
        </div>
      </motion.div>
    </section>
  );
}
