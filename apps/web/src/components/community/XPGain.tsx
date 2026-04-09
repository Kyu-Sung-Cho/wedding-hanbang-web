"use client";

import { useEffect, useState } from "react";

interface XPGainProps {
  amount: number;
  onComplete?: () => void;
}

// XP 획득 시 "+20 XP" 플로팅 애니메이션
export default function XPGain({ amount, onComplete }: XPGainProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, 1500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  if (!visible || amount <= 0) return null;

  return (
    <span className="pointer-events-none inline-block animate-xp-float text-sm font-bold text-[#2563EB]">
      +{amount} XP
    </span>
  );
}
