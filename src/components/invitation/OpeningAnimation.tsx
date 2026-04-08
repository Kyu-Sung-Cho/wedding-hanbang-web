"use client";

import { useEffect, useState, useMemo } from "react";
import type { OpeningAnimation as AnimationType } from "@/types/invitation.types";

interface Props {
  type: AnimationType;
  colors: string[];
  fonts: { heading: string; body: string };
  groomName: string;
  brideName: string;
  onComplete: () => void;
}

export default function OpeningAnimation({ type, colors, fonts, groomName, brideName, onComplete }: Props) {
  const [phase, setPhase] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 500);
    const t2 = setTimeout(() => setPhase(2), 2000);
    const t3 = setTimeout(() => setExiting(true), 3000);
    const t4 = setTimeout(onComplete, 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onComplete]);

  const handleClick = () => {
    setExiting(true);
    setTimeout(onComplete, 800);
  };

  const bg = colors[1] || "#FDFCFA";
  const accent = colors[0] || "#C4967E";
  const text = colors[2] || "#1A1A1F";

  // 퇴장 애니메이션 스타일
  const exitStyle = useMemo((): React.CSSProperties => {
    if (!exiting) return {};
    const base: React.CSSProperties = { transition: "all 0.8s ease-in-out" };
    switch (type) {
      case "slideUp": return { ...base, opacity: 0, transform: "translateY(-100px)" };
      case "zoomIn": return { ...base, opacity: 0, transform: "scale(2)" };
      case "heartBeat": return { ...base, opacity: 0, transform: "scale(0.5)", transition: "all 0.6s ease-in" };
      case "typewriter": return { ...base, opacity: 0, transform: "translateX(-50px)", transition: "all 0.6s ease-in" };
      case "morphing": return { ...base, opacity: 0, transform: "scale(0)", borderRadius: "50%" };
      case "leafFall": case "petalFall": return { ...base, opacity: 0, transform: "translateY(50px) rotate(10deg)", transition: "all 1s ease-in" };
      case "floatUp": return { ...base, opacity: 0, transform: "translateY(-200px)", transition: "all 1s ease-in" };
      case "waveSlide": return { ...base, opacity: 0, transform: "translateX(-300px)" };
      case "snowFall": return { ...base, opacity: 0, transform: "translateY(100px)", transition: "all 1.2s ease-in" };
      case "filmRoll": return { ...base, opacity: 0, transform: "translateY(-500px)" };
      case "pageFlip": case "flipCard": return { ...base, opacity: 0, transform: "perspective(800px) rotateY(90deg)", transition: "all 0.6s ease-in" };
      case "waterDrop": case "ripple": return { ...base, opacity: 0, transform: "scale(3)" };
      case "letterOpen": return { ...base, opacity: 0, transform: "scaleY(0)", transition: "all 0.6s ease-in" };
      case "spiralIn": return { ...base, opacity: 0, transform: "rotate(180deg) scale(0)" };
      case "blindsOpen": return { ...base, opacity: 0, transform: "scaleX(0)", transition: "all 0.6s ease-in" };
      case "slideRotate": return { ...base, opacity: 0, transform: "rotate(-15deg) translateX(-200px)" };
      case "bounceIn": return { ...base, opacity: 0, transform: "scale(0)", transition: "all 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)" };
      case "doorOpen": return { ...base, opacity: 0, transform: "perspective(800px) rotateY(-90deg)" };
      case "sparkle": case "confetti": return { ...base, opacity: 0, transform: "scale(1.2)" };
      case "lightReveal": return { ...base, opacity: 0, filter: "brightness(3)" };
      case "parallaxZoom": return { ...base, opacity: 0, transform: "scale(1.5) translateY(-100px)", transition: "all 1s ease-in" };
      default: return { ...base, opacity: 0 };
    }
  }, [exiting, type]);

  // 장식 요소 위치를 메모이즈 (렌더링마다 바뀌지 않도록)
  const decorations = useMemo(() => {
    const items: { left: string; top: string; delay: string; duration: string }[] = [];
    if (type === "sparkle" || type === "confetti") {
      for (let i = 0; i < 12; i++) {
        items.push({
          left: `${10 + Math.random() * 80}%`,
          top: `${10 + Math.random() * 80}%`,
          delay: `${Math.random() * 1.5}s`,
          duration: `${2 + Math.random()}s`,
        });
      }
    } else if (type === "snowFall") {
      for (let i = 0; i < 15; i++) {
        items.push({
          left: `${Math.random() * 100}%`,
          top: "-5%",
          delay: `${Math.random() * 2}s`,
          duration: `${3 + Math.random() * 2}s`,
        });
      }
    } else if (type === "petalFall" || type === "leafFall") {
      for (let i = 0; i < 8; i++) {
        items.push({
          left: `${10 + Math.random() * 80}%`,
          top: "-10%",
          delay: `${Math.random() * 2}s`,
          duration: `${4 + Math.random() * 2}s`,
        });
      }
    }
    return items;
  }, [type]);

  const renderDecorations = () => {
    switch (type) {
      case "sparkle": case "confetti":
        return decorations.map((d, i) => (
          <div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              background: accent,
              left: d.left,
              top: d.top,
              animation: `inviteSparkle ${d.duration} ${d.delay} infinite`,
            }}
          />
        ));
      case "snowFall":
        return decorations.map((d, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-white"
            style={{
              left: d.left,
              top: d.top,
              animation: `inviteSnowFall ${d.duration} ${d.delay} infinite linear`,
            }}
          />
        ));
      case "petalFall":
        return decorations.map((d, i) => (
          <div
            key={i}
            className="absolute text-[21px]"
            style={{
              left: d.left,
              top: d.top,
              animation: `invitePetalFall ${d.duration} ${d.delay} infinite linear`,
            }}
          >
            🌸
          </div>
        ));
      case "leafFall":
        return decorations.map((d, i) => (
          <div
            key={i}
            className="absolute text-[21px]"
            style={{
              left: d.left,
              top: d.top,
              animation: `invitePetalFall ${d.duration} ${d.delay} infinite linear`,
            }}
          >
            🍂
          </div>
        ));
      case "heartBeat":
        return (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ animation: "inviteHeartBeat 1.5s infinite" }}
          >
            <div className="text-[60px] opacity-10">❤️</div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      onClick={handleClick}
      className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer overflow-hidden"
      style={{ background: bg, ...exitStyle }}
    >
      {renderDecorations()}

      <div className="text-center relative z-10">
        <p
          className="text-[21px] tracking-[0.3em] uppercase mb-4"
          style={{
            color: accent,
            opacity: phase >= 1 ? 1 : 0,
            transition: "opacity 0.6s ease",
          }}
        >
          Wedding Invitation
        </p>
        <h1
          className="text-[38px] font-light leading-[1.5]"
          style={{
            fontFamily: `'${fonts.heading}', serif`,
            color: text,
            opacity: phase >= 1 ? 1 : 0,
            transform: phase >= 1 ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.8s ease 0.2s, transform 0.8s ease 0.2s",
          }}
        >
          {groomName} & {brideName}
        </h1>
        <p
          className="text-[21px] mt-6 tracking-wide"
          style={{
            color: accent,
            opacity: phase >= 2 ? 0.5 : 0,
            transition: "opacity 0.5s ease",
          }}
        >
          터치하여 열기
        </p>
      </div>
    </div>
  );
}
