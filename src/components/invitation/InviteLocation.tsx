"use client";

import type { Invitation } from "@/types/invitation.types";
import { MapPin, Navigation, Copy, Check } from "lucide-react";
import { useState } from "react";

interface Props {
  invitation: Invitation;
  colors: string[];
}

export default function InviteLocation({ invitation, colors }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (invitation.wedding_address) {
      navigator.clipboard.writeText(invitation.wedding_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section className="py-12 px-6">
      <div className="animate-fade-in" style={{ animationDuration: "0.6s" }}>
        <h3 className="text-center text-[23px] tracking-[0.2em] uppercase mb-6" style={{ color: colors[0] }}>
          Location
        </h3>

        <div className="p-5 rounded-2xl" style={{ background: `${colors[0]}08` }}>
          <div className="flex items-start gap-3 mb-4">
            <MapPin className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: colors[0] }} />
            <div>
              <p className="text-[38px] font-medium">{invitation.wedding_venue}</p>
              {invitation.wedding_hall && (
                <p className="text-[25px] opacity-60">{invitation.wedding_hall}</p>
              )}
            </div>
          </div>

          {invitation.wedding_address && (
            <div className="flex items-center gap-2 mb-4 pl-8">
              <p className="text-[25px] opacity-60 flex-1">{invitation.wedding_address}</p>
              <button onClick={handleCopy} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white/50">
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 opacity-40" />
                )}
              </button>
            </div>
          )}

          {invitation.wedding_transport && (
            <div className="mb-4 pl-8">
              <p className="text-[38px] font-medium mb-2 opacity-70" style={{ color: colors[0] }}>
                오시는 길
              </p>
              <div className="text-[38px] opacity-60 leading-[1.8] whitespace-pre-line">
                {invitation.wedding_transport}
              </div>
            </div>
          )}

          <div className="flex gap-2 pl-8">
            {invitation.wedding_map_url && (
              <a
                href={invitation.wedding_map_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[38px] font-medium text-white transition-colors"
                style={{ background: colors[0] }}
              >
                <Navigation className="w-3.5 h-3.5" />
                지도 보기
              </a>
            )}
            {invitation.wedding_address && (
              <a
                href={`https://map.kakao.com/?q=${encodeURIComponent(invitation.wedding_address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[38px] font-medium border transition-colors"
                style={{ borderColor: `${colors[0]}40`, color: colors[0] }}
              >
                카카오맵
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
