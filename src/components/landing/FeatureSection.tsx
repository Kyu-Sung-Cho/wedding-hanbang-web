"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface FeatureSectionProps {
  id?: string;
  align: "left" | "right";
  badge: string;
  title: string;
  description: string;
  children: ReactNode;
}

export default function FeatureSection({
  id,
  align,
  badge,
  title,
  description,
  children,
}: FeatureSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section id={id} className="bg-white px-6 py-20 md:py-28">
      <div
        ref={ref}
        className={`mx-auto grid max-w-7xl items-center gap-12 md:grid-cols-2 md:gap-20 ${
          align === "right" ? "md:[direction:rtl]" : ""
        }`}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(24px)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        {/* 텍스트 */}
        <div className={align === "right" ? "md:[direction:ltr]" : ""}>
          <span className="mb-4 inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {badge}
          </span>
          <h2 className="mb-5 text-[clamp(28px,3.5vw,40px)] font-bold leading-[1.25] tracking-[-0.02em] text-gray-900">
            {title}
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-gray-500">
            {description}
          </p>
        </div>

        {/* 비주얼 */}
        <div className={align === "right" ? "md:[direction:ltr]" : ""}>
          {children}
        </div>
      </div>
    </section>
  );
}
