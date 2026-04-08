"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Invitation, InvitationPhoto, InvitationAccount, InvitationGuestbook as GuestbookEntry } from "@/types/invitation.types";
import OpeningAnimation from "@/components/invitation/OpeningAnimation";
import InviteHero from "@/components/invitation/InviteHero";
import InviteGreeting from "@/components/invitation/InviteGreeting";
import InviteCouple from "@/components/invitation/InviteCouple";
import InviteGallery from "@/components/invitation/InviteGallery";
import InviteLocation from "@/components/invitation/InviteLocation";
import InviteCalendar from "@/components/invitation/InviteCalendar";
import InviteRsvp from "@/components/invitation/InviteRsvp";
import InviteGuestbook from "@/components/invitation/InviteGuestbook";
import InviteAccount from "@/components/invitation/InviteAccount";
import InviteFooter from "@/components/invitation/InviteFooter";

interface InviteData {
  invitation: Invitation;
  photos: InvitationPhoto[];
  accounts: InvitationAccount[];
  guestbook: GuestbookEntry[];
}

export default function InvitePage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOpening, setShowOpening] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const res = await fetch(`/api/invitations/guest/${slug}`);
        if (!res.ok) throw new Error("청첩장을 찾을 수 없습니다.");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ivory-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[21px] text-taupe-500">청첩장을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ivory-50">
        <div className="text-center px-6">
          <div className="text-[54px] mb-4">💌</div>
          <h1 className="text-[23px] font-medium text-noir-800 mb-2">
            {error ?? "청첩장을 찾을 수 없습니다."}
          </h1>
          <p className="text-[21px] text-taupe-500">
            링크가 올바른지 확인해주세요.
          </p>
        </div>
      </div>
    );
  }

  const { invitation, photos, accounts, guestbook } = data;
  const template = invitation.template;
  const colors = invitation.custom_colors ?? template?.color_palette ?? ["#C4967E", "#FDFCFA", "#1A1A1F"];
  const fonts = invitation.custom_fonts ?? template?.font_pair ?? { heading: "Noto Serif KR", body: "Noto Sans KR" };

  const handleRsvpSubmit = async (rsvpData: Record<string, unknown>) => {
    await fetch(`/api/invitations/guest/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "rsvp", ...rsvpData }),
    });
  };

  const handleGuestbookSubmit = async (gbData: Record<string, unknown>) => {
    const res = await fetch(`/api/invitations/guest/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "guestbook", ...gbData }),
    });
    if (res.ok) {
      const result = await res.json();
      setData((prev) =>
        prev ? { ...prev, guestbook: [result.entry, ...prev.guestbook] } : prev
      );
    }
  };

  return (
    <div
      className="min-h-screen max-w-[540px] mx-auto overflow-hidden"
      style={{
        fontFamily: `'${fonts.body}', sans-serif`,
        background: colors[1] || "#FDFCFA",
        color: colors[2] || "#1A1A1F",
      }}
    >
      {/* 오프닝 애니메이션 */}
      {showOpening && (
        <OpeningAnimation
          type={invitation.opening_animation}
          colors={colors}
          fonts={fonts}
          groomName={invitation.groom_name ?? ""}
          brideName={invitation.bride_name ?? ""}
          onComplete={() => setShowOpening(false)}
        />
      )}

      {!showOpening && (
        <div className="animate-fade-in" style={{ animationDuration: "0.8s" }}>
          <InviteHero invitation={invitation} colors={colors} fonts={fonts} photos={photos} />

          {invitation.greeting_message && (
            <InviteGreeting invitation={invitation} colors={colors} fonts={fonts} />
          )}

          {(invitation.groom_father || invitation.bride_father) && (
            <InviteCouple invitation={invitation} colors={colors} fonts={fonts} />
          )}

          {(invitation.gallery_enabled !== false) && photos.length > 1 && (
            <InviteGallery photos={photos} colors={colors} skipFirst />
          )}

          {invitation.wedding_date && (
            <InviteCalendar invitation={invitation} colors={colors} fonts={fonts} />
          )}

          {(invitation.location_enabled !== false) && invitation.wedding_venue && (
            <InviteLocation invitation={invitation} colors={colors} />
          )}

          {invitation.rsvp_enabled && (
            <InviteRsvp colors={colors} onSubmit={handleRsvpSubmit} />
          )}

          {invitation.account_enabled && accounts.length > 0 && (
            <InviteAccount accounts={accounts} colors={colors} />
          )}

          {invitation.guestbook_enabled && (
            <InviteGuestbook entries={guestbook} colors={colors} onSubmit={handleGuestbookSubmit} />
          )}

          <InviteFooter invitation={invitation} colors={colors} />
        </div>
      )}
    </div>
  );
}
