"use client";

import type { Invitation, InvitationPhoto } from "@/types/invitation.types";

interface Props {
  invitation: Invitation;
  colors: string[];
  fonts: { heading: string; body: string };
  photos?: InvitationPhoto[];
}

export default function InviteHero({ invitation, colors, fonts, photos }: Props) {
  const mainPhoto = photos?.[0];
  const weddingDate = invitation.wedding_date
    ? new Date(invitation.wedding_date)
    : null;

  const groomName = invitation.groom_name?.trim();
  const brideName = invitation.bride_name?.trim();
  const hasNames = groomName || brideName;

  return (
    <section className="relative text-center overflow-hidden">
      {/* 메인 사진 */}
      {mainPhoto && (
        <div className="w-full aspect-[3/4] max-h-[520px] overflow-hidden">
          <img
            src={mainPhoto.url}
            alt={mainPhoto.caption ?? ""}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div
        className="relative py-20 px-6"
      >
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            background: `radial-gradient(circle at 30% 20%, ${colors[0]}, transparent 50%), radial-gradient(circle at 70% 80%, ${colors[0]}, transparent 50%)`,
          }}
        />

        <div className="relative z-10 animate-fade-in" style={{ animationDuration: "0.8s" }}>
          <p className="text-[10px] tracking-[0.3em] uppercase mb-8 opacity-60" style={{ color: colors[0] }}>
            Wedding Invitation
          </p>

        {hasNames ? (
          <h1
            className="text-[28px] font-light leading-[1.6] mb-6"
            style={{ fontFamily: `'${fonts.heading}', serif`, color: colors[2] }}
          >
            {groomName || "신랑"} <span className="text-[20px] opacity-40" style={{ color: colors[0] }}>&</span> {brideName || "신부"}
          </h1>
        ) : (
          <h1
            className="text-[22px] font-light mb-6"
            style={{ fontFamily: `'${fonts.heading}', serif`, color: colors[2] }}
          >
            {invitation.title || "우리 결혼합니다"}
          </h1>
        )}

        <div className="w-8 h-px mx-auto mb-5 opacity-30" style={{ background: colors[0] }} />

        {weddingDate && (
          <p className="text-[14px] tracking-wide mb-2" style={{ color: colors[0] }}>
            {weddingDate.getFullYear()}.
            {String(weddingDate.getMonth() + 1).padStart(2, "0")}.
            {String(weddingDate.getDate()).padStart(2, "0")}
            {" "}
            {["일", "월", "화", "수", "목", "금", "토"][weddingDate.getDay()]}요일
            {" "}
            {weddingDate.getHours() < 12 ? "오전" : "오후"}
            {" "}
            {weddingDate.getHours() > 12 ? weddingDate.getHours() - 12 : weddingDate.getHours() === 0 ? 12 : weddingDate.getHours()}시
            {weddingDate.getMinutes() > 0 ? ` ${weddingDate.getMinutes()}분` : ""}
          </p>
        )}

        {invitation.wedding_venue && (
          <p className="text-[13px] opacity-50">
            {invitation.wedding_venue}
            {invitation.wedding_hall ? ` ${invitation.wedding_hall}` : ""}
          </p>
        )}
        </div>
      </div>
    </section>
  );
}
