"use client";

import { motion } from "framer-motion";
import type { Invitation } from "@/types/invitation.types";

interface Props {
  invitation: Invitation;
  colors: string[];
  fonts: { heading: string; body: string };
}

export default function InviteCouple({ invitation, colors, fonts }: Props) {
  return (
    <section className="py-12 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="flex items-stretch gap-4"
      >
        {/* 신랑 측 */}
        <div className="flex-1 text-center p-5 rounded-2xl" style={{ background: `${colors[0]}08` }}>
          <div
            className="w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center text-[14px] font-medium text-white"
            style={{ background: colors[0] }}
          >
            郎
          </div>
          <p className="text-[11px] mb-1 opacity-50">신랑</p>
          <p
            className="text-[16px] font-medium mb-2"
            style={{ fontFamily: `'${fonts.heading}', serif` }}
          >
            {invitation.groom_name ?? ""}
          </p>
          {(invitation.groom_father || invitation.groom_mother) && (
            <p className="text-[11px] opacity-50 leading-relaxed">
              {invitation.groom_father && <span>{invitation.groom_father}</span>}
              {invitation.groom_father && invitation.groom_mother && <span> · </span>}
              {invitation.groom_mother && <span>{invitation.groom_mother}</span>}
              <span className="block mt-0.5">의 아들</span>
            </p>
          )}
        </div>

        {/* 구분자 */}
        <div className="flex items-center">
          <span className="text-[20px]" style={{ color: colors[0] }}>&</span>
        </div>

        {/* 신부 측 */}
        <div className="flex-1 text-center p-5 rounded-2xl" style={{ background: `${colors[0]}08` }}>
          <div
            className="w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center text-[14px] font-medium text-white"
            style={{ background: colors[0] }}
          >
            婦
          </div>
          <p className="text-[11px] mb-1 opacity-50">신부</p>
          <p
            className="text-[16px] font-medium mb-2"
            style={{ fontFamily: `'${fonts.heading}', serif` }}
          >
            {invitation.bride_name ?? ""}
          </p>
          {(invitation.bride_father || invitation.bride_mother) && (
            <p className="text-[11px] opacity-50 leading-relaxed">
              {invitation.bride_father && <span>{invitation.bride_father}</span>}
              {invitation.bride_father && invitation.bride_mother && <span> · </span>}
              {invitation.bride_mother && <span>{invitation.bride_mother}</span>}
              <span className="block mt-0.5">의 딸</span>
            </p>
          )}
        </div>
      </motion.div>
    </section>
  );
}
