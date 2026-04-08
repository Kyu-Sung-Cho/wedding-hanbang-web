"use client";

import type { Invitation } from "@/types/invitation.types";

interface Props {
  invitation: Invitation;
  colors: string[];
  fonts: { heading: string; body: string };
}

export default function InviteCouple({ invitation, colors, fonts }: Props) {
  const renderSide = (
    role: string,
    name: string | null,
    father: string | null,
    mother: string | null,
    relation: string,
  ) => (
    <div className="flex-1 text-center">
      <p className="text-[21px] tracking-[0.1em] uppercase mb-2 opacity-40">{role}</p>
      <p
        className="text-[21px] font-light mb-3"
        style={{ fontFamily: `'${fonts.heading}', serif` }}
      >
        {name || role}
      </p>
      {(father || mother) && (
        <p className="text-[21px] opacity-50 leading-relaxed">
          {father && <span>{father}</span>}
          {father && mother && <span> · </span>}
          {mother && <span>{mother}</span>}
          <span className="block text-[21px] mt-0.5 opacity-70">의 {relation}</span>
        </p>
      )}
    </div>
  );

  return (
    <section className="py-10 px-6">
      <div className="flex items-start animate-fade-in" style={{ animationDuration: "0.6s" }}>
        {renderSide("Groom", invitation.groom_name, invitation.groom_father, invitation.groom_mother, "아들")}

        <div className="flex flex-col items-center justify-center px-3 pt-6">
          <div className="w-px h-6 opacity-20" style={{ background: colors[0] }} />
          <span className="text-[21px] my-2 opacity-40" style={{ color: colors[0] }}>&</span>
          <div className="w-px h-6 opacity-20" style={{ background: colors[0] }} />
        </div>

        {renderSide("Bride", invitation.bride_name, invitation.bride_father, invitation.bride_mother, "딸")}
      </div>
    </section>
  );
}
