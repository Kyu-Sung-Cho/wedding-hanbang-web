"use client";

import { useState } from "react";
import { Check } from "lucide-react";

interface Props {
  colors: string[];
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}

export default function InviteRsvp({ colors, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [attending, setAttending] = useState<boolean | null>(null);
  const [guestCount, setGuestCount] = useState(1);
  const [side, setSide] = useState<string>("both");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || attending === null) return;
    setSubmitting(true);
    await onSubmit({
      guest_name: name,
      phone,
      attending,
      guest_count: attending ? guestCount : 0,
      side,
    });
    setSubmitted(true);
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <section className="py-12 px-6">
        <div
          className="text-center p-8 rounded-2xl animate-fade-in"
          style={{ background: `${colors[0]}08`, animationDuration: "0.4s" }}
        >
          <div
            className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{ background: colors[0] }}
          >
            <Check className="w-6 h-6 text-white" />
          </div>
          <p className="text-[21px] font-medium">감사합니다!</p>
          <p className="text-[21px] opacity-60 mt-1">참석 여부가 전달되었습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-6">
      <div className="animate-fade-in" style={{ animationDuration: "0.6s" }}>
        <h3 className="text-center text-[21px] tracking-[0.2em] uppercase mb-6" style={{ color: colors[0] }}>
          RSVP
        </h3>

        <div className="flex flex-col gap-3 p-5 rounded-2xl" style={{ background: `${colors[0]}08` }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름"
            className="w-full px-4 py-2.5 rounded-xl bg-white border border-black/[0.06] text-[21px] placeholder:opacity-40 focus:outline-none"
            style={{ borderColor: name ? `${colors[0]}40` : undefined }}
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="연락처 (선택)"
            className="w-full px-4 py-2.5 rounded-xl bg-white border border-black/[0.06] text-[21px] placeholder:opacity-40 focus:outline-none"
          />

          <div className="flex gap-2">
            {[
              { value: true, label: "참석합니다" },
              { value: false, label: "불참입니다" },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setAttending(opt.value)}
                className={`flex-1 py-2.5 rounded-xl text-[21px] font-medium border transition-colors ${
                  attending === opt.value
                    ? "text-white border-transparent"
                    : "bg-white border-black/[0.06] opacity-60"
                }`}
                style={attending === opt.value ? { background: colors[0] } : undefined}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {attending === true && (
            <div className="flex items-center gap-3">
              <span className="text-[21px] opacity-60">참석 인원</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                  className="w-8 h-8 rounded-lg bg-white border border-black/[0.06] text-[21px]"
                >
                  -
                </button>
                <span className="text-[21px] font-medium w-6 text-center">{guestCount}</span>
                <button
                  onClick={() => setGuestCount(guestCount + 1)}
                  className="w-8 h-8 rounded-lg bg-white border border-black/[0.06] text-[21px]"
                >
                  +
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {[
              { value: "groom", label: "신랑측" },
              { value: "bride", label: "신부측" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSide(opt.value)}
                className={`flex-1 py-2 rounded-xl text-[21px] border transition-colors ${
                  side === opt.value
                    ? "font-medium border-transparent text-white"
                    : "bg-white border-black/[0.06] opacity-50"
                }`}
                style={side === opt.value ? { background: `${colors[0]}CC` } : undefined}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleSubmit}
            disabled={!name.trim() || attending === null || submitting}
            className="w-full py-3 rounded-xl text-[21px] font-medium text-white disabled:opacity-40 transition-colors"
            style={{ background: colors[0] }}
          >
            {submitting ? "전송 중..." : "참석 여부 전달하기"}
          </button>
        </div>
      </div>
    </section>
  );
}
