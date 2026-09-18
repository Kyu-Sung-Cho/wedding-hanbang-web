import type { SVGProps } from "react";
import { amoraIdentity } from "@hanbang/design-tokens";

type AmoraMarkProps = SVGProps<SVGSVGElement> & { size?: number | string; ring?: boolean };

export default function AmoraMark({ size = 24, strokeWidth = amoraIdentity.strokeWidth, ring = true, ...props }: AmoraMarkProps) {
  return (
    <svg width={size} height={size} viewBox={amoraIdentity.viewBox} fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" data-amora-mark="compass" {...props}>
      {ring && <path d={amoraIdentity.ring} />}
      {amoraIdentity.rose.map(path => <path key={path} d={path} fill="currentColor" stroke="none" />)}
    </svg>
  );
}
