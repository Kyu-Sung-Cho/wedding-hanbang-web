"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
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

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 500);
    const t2 = setTimeout(() => setPhase(2), 2000);
    const t3 = setTimeout(onComplete, 3500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  const bg = colors[1] || "#FDFCFA";
  const accent = colors[0] || "#C4967E";
  const text = colors[2] || "#1A1A1F";

  // 공통 콘텐츠
  const content = (
    <div className="text-center relative z-10">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 1 ? 1 : 0 }}
        transition={{ duration: 0.6 }}
        className="text-[11px] tracking-[0.3em] uppercase mb-4"
        style={{ color: accent }}
      >
        Wedding Invitation
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-[24px] font-light leading-[1.5]"
        style={{ fontFamily: `'${fonts.heading}', serif`, color: text }}
      >
        {groomName} & {brideName}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 2 ? 0.5 : 0 }}
        transition={{ duration: 0.5 }}
        className="text-[12px] mt-6 tracking-wide"
        style={{ color: accent }}
      >
        터치하여 열기
      </motion.p>
    </div>
  );

  // 각 애니메이션별 래퍼 variants
  const getVariants = () => {
    switch (type) {
      case "fadeIn":
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, transition: { duration: 0.8 } },
        };
      case "slideUp":
        return {
          initial: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -100, transition: { duration: 0.8 } },
        };
      case "zoomIn":
        return {
          initial: { opacity: 1, scale: 1 },
          exit: { opacity: 0, scale: 2, transition: { duration: 0.8 } },
        };
      case "curtainOpen":
      case "curtainReveal":
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, transition: { duration: 0.6 } },
        };
      case "sparkle":
      case "confetti":
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, scale: 1.2, transition: { duration: 0.8 } },
        };
      case "heartBeat":
        return {
          initial: { opacity: 1, scale: 1 },
          exit: { opacity: 0, scale: 0.5, transition: { duration: 0.6 } },
        };
      case "typewriter":
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, x: -50, transition: { duration: 0.6 } },
        };
      case "glitch":
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, x: [0, -10, 10, -5, 5, 0], transition: { duration: 0.5 } },
        };
      case "morphing":
        return {
          initial: { opacity: 1, borderRadius: "0%" },
          exit: { opacity: 0, borderRadius: "50%", scale: 0, transition: { duration: 0.8 } },
        };
      case "leafFall":
      case "petalFall":
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, y: 50, rotate: 10, transition: { duration: 1 } },
        };
      case "floatUp":
        return {
          initial: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -200, transition: { duration: 1, ease: "easeIn" as const } },
        };
      case "waveSlide":
        return {
          initial: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -300, transition: { duration: 0.8 } },
        };
      case "snowFall":
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, y: 100, transition: { duration: 1.2 } },
        };
      case "filmRoll":
        return {
          initial: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -500, transition: { duration: 0.8 } },
        };
      case "pageFlip":
      case "flipCard":
        return {
          initial: { opacity: 1, rotateY: 0 },
          exit: { opacity: 0, rotateY: 90, transition: { duration: 0.6 } },
        };
      case "waterDrop":
      case "ripple":
        return {
          initial: { opacity: 1, scale: 1 },
          exit: { opacity: 0, scale: 3, transition: { duration: 0.8 } },
        };
      case "letterOpen":
        return {
          initial: { opacity: 1, scaleY: 1 },
          exit: { opacity: 0, scaleY: 0, transition: { duration: 0.6, ease: "easeIn" as const } },
        };
      case "spiralIn":
        return {
          initial: { opacity: 1, rotate: 0, scale: 1 },
          exit: { opacity: 0, rotate: 180, scale: 0, transition: { duration: 0.8 } },
        };
      case "blindsOpen":
        return {
          initial: { opacity: 1, scaleX: 1 },
          exit: { opacity: 0, scaleX: 0, transition: { duration: 0.6 } },
        };
      case "fadeScale":
        return {
          initial: { opacity: 1, scale: 1 },
          exit: { opacity: 0, scale: 0.8, transition: { duration: 0.6 } },
        };
      case "slideRotate":
        return {
          initial: { opacity: 1, rotate: 0, x: 0 },
          exit: { opacity: 0, rotate: -15, x: -200, transition: { duration: 0.8 } },
        };
      case "bounceIn":
        return {
          initial: { opacity: 1, scale: 1 },
          exit: { opacity: 0, scale: 0, transition: { type: "spring" as const, duration: 0.6 } },
        };
      case "doorOpen":
        return {
          initial: { opacity: 1, perspective: 800 },
          exit: { opacity: 0, rotateY: -90, transition: { duration: 0.8 } },
        };
      case "lightReveal":
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, filter: "brightness(3)", transition: { duration: 0.6 } },
        };
      case "parallaxZoom":
        return {
          initial: { opacity: 1, scale: 1, y: 0 },
          exit: { opacity: 0, scale: 1.5, y: -100, transition: { duration: 1 } },
        };
      default:
        return {
          initial: { opacity: 1 },
          exit: { opacity: 0, transition: { duration: 0.8 } },
        };
    }
  };

  const variants = getVariants();

  // 특수 장식 요소
  const renderDecorations = () => {
    switch (type) {
      case "sparkle":
      case "confetti":
        return Array.from({ length: 12 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{ background: accent, left: `${10 + Math.random() * 80}%`, top: `${10 + Math.random() * 80}%` }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0, 1, 0],
              y: [0, -20, -40],
            }}
            transition={{ duration: 2, delay: Math.random() * 1.5, repeat: Infinity }}
          />
        ));
      case "snowFall":
        return Array.from({ length: 15 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-white"
            style={{ left: `${Math.random() * 100}%`, top: `-5%` }}
            animate={{ y: ["0vh", "105vh"], opacity: [0.8, 0] }}
            transition={{ duration: 3 + Math.random() * 2, delay: Math.random() * 2, repeat: Infinity }}
          />
        ));
      case "petalFall":
        return Array.from({ length: 8 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-[16px]"
            style={{ left: `${10 + Math.random() * 80}%`, top: `-10%` }}
            animate={{
              y: ["0vh", "110vh"],
              x: [0, Math.random() * 40 - 20],
              rotate: [0, 360],
              opacity: [0.6, 0],
            }}
            transition={{ duration: 4 + Math.random() * 2, delay: Math.random() * 2, repeat: Infinity }}
          >
            🌸
          </motion.div>
        ));
      case "leafFall":
        return Array.from({ length: 8 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-[14px]"
            style={{ left: `${10 + Math.random() * 80}%`, top: `-5%` }}
            animate={{
              y: ["0vh", "110vh"],
              x: [0, Math.random() * 60 - 30],
              rotate: [0, 360],
              opacity: [0.5, 0],
            }}
            transition={{ duration: 5 + Math.random() * 2, delay: Math.random() * 2, repeat: Infinity }}
          >
            🍂
          </motion.div>
        ));
      case "heartBeat":
        return (
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <div className="text-[60px] opacity-10">❤️</div>
          </motion.div>
        );
      default:
        return null;
    }
  };

  return (
    <motion.div
      {...variants}
      onClick={onComplete}
      className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer overflow-hidden"
      style={{ background: bg }}
    >
      {renderDecorations()}
      {content}
    </motion.div>
  );
}
