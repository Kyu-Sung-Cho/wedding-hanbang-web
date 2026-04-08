"use client";

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
      <div className="animate-fade-in" style={{ animationDuration: "0.6s" }}>
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-8 h-px" style={{ background: colors[0] }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: colors[0] }} />
          <div className="w-8 h-px" style={{ background: colors[0] }} />
        </div>

        <h2
          className="text-[21px] font-light mb-6"
          style={{ fontFamily: `'${fonts.heading}', serif`, color: colors[2] }}
        >
          {invitation.greeting_title}
        </h2>

        <p
          className="text-[21px] leading-[2] whitespace-pre-line opacity-70"
          style={{ fontFamily: `'${fonts.body}', sans-serif` }}
        >
          {invitation.greeting_message}
        </p>

        <div className="flex items-center justify-center gap-3 mt-6">
          <div className="w-8 h-px" style={{ background: colors[0] }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: colors[0] }} />
          <div className="w-8 h-px" style={{ background: colors[0] }} />
        </div>
      </div>
    </section>
  );
}
