"use client";

import { useId, type CSSProperties } from "react";
import { amoraOrb, type AmoraOrbMood } from "@hanbang/design-tokens";

type AmoraOrbProps = {
  /** 가로세로 픽셀. 아티팩트는 150·110·64·44·40·36·32 를 쓴다. */
  size?: number;
  /** `working` 이면 더 빨리 돈다. `happy` 는 모양이 `calm` 과 같다(아티팩트 그대로). */
  mood?: AmoraOrbMood;
  /** 옆에 아모라 이름이 이미 적혀 있으면 읽어 주는 이름을 두 번 말하지 않게 숨긴다. */
  decorative?: boolean;
  className?: string;
};

type OrbEllipse = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  gradient: string;
  opacity?: number;
  rotate?: number;
};

/**
 * 아모라 오브 — 청첩장 디자인(2026-11-17)의 아모라 모습.
 *
 * 모양과 빠르기는 `@hanbang/design-tokens` 의 `amoraOrb` 에서 읽는다(네이티브와 같은 값).
 * 한 화면에 여러 개가 있어도 그라데이션 이름이 겹치지 않게 `useId` 로 이름을 나눈다.
 * 움직임은 `globals.css` 의 `amora-orb-*` 규칙이 맡고, 움직임 줄이기 설정이면 멈춘다.
 */
export default function AmoraOrb({ size = 200, mood = "calm", decorative = false, className }: AmoraOrbProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = (name: string) => `amora-orb-${uid}-${name}`;
  const working = mood === "working";
  const seconds = working ? amoraOrb.busySeconds : amoraOrb.calmSeconds;
  const label = working ? amoraOrb.labels.working : amoraOrb.labels.calm;
  const timing = {
    "--amora-orb-a": `${seconds.a}s`,
    "--amora-orb-b": `${seconds.b}s`,
    "--amora-orb-c": `${seconds.c}s`,
    "--amora-orb-halo": `${seconds.halo}s`,
  } as CSSProperties;
  const { center: c } = amoraOrb;

  return (
    <svg
      width={size}
      height={size}
      viewBox={amoraOrb.viewBox}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
      data-amora-orb={mood}
      className={["amora-orb", className].filter(Boolean).join(" ")}
      style={{ overflow: "visible", flex: "none", ...timing }}
    >
      <defs>
        <clipPath id={ref("clip")}>
          <circle cx={c} cy={c} r={amoraOrb.clipRadius} />
        </clipPath>
        {Object.entries(amoraOrb.gradients).map(([name, gradient]) => (
          <radialGradient key={name} id={ref(name)} cx={gradient.cx} cy={gradient.cy} r={gradient.r}>
            {gradient.stops.map(([offset, color, opacity]) => (
              <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
            ))}
          </radialGradient>
        ))}
      </defs>
      <circle className="amora-orb-halo" cx={c} cy={c} r={amoraOrb.halo.r} fill={`url(#${ref(amoraOrb.halo.gradient)})`} />
      <g clipPath={`url(#${ref("clip")})`}>
        <rect x="0" y="0" width="200" height="200" fill={`url(#${ref("base")})`} />
        {amoraOrb.layers.map((layer) => (
          <g key={layer.id} className={`amora-orb-layer amora-orb-${layer.id}`}>
            {(layer.ellipses as readonly OrbEllipse[]).map((ellipse) => (
              <ellipse
                key={`${ellipse.cx}-${ellipse.cy}`}
                cx={ellipse.cx}
                cy={ellipse.cy}
                rx={ellipse.rx}
                ry={ellipse.ry}
                fill={`url(#${ref(ellipse.gradient)})`}
                opacity={ellipse.opacity}
                transform={ellipse.rotate === undefined ? undefined : `rotate(${ellipse.rotate} ${c} ${c})`}
              />
            ))}
          </g>
        ))}
      </g>
      <circle cx={c} cy={c} r={amoraOrb.rim.r} fill={`url(#${ref(amoraOrb.rim.gradient)})`} />
      <circle
        cx={c}
        cy={c}
        r={amoraOrb.outline.r}
        fill="none"
        stroke={amoraOrb.outline.color}
        strokeOpacity={amoraOrb.outline.opacity}
        strokeWidth={amoraOrb.outline.width}
      />
    </svg>
  );
}
