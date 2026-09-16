import type { SVGProps } from "react";
import { amoraIdentity } from "@hanbang/design-tokens";

type AmoraMarkProps = SVGProps<SVGSVGElement> & { size?: number | string };

export default function AmoraMark({ size = 24, strokeWidth = amoraIdentity.strokeWidth, ...props }: AmoraMarkProps) {
  return (
    <svg width={size} height={size} viewBox={amoraIdentity.viewBox} fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" data-amora-mark="rings" {...props}>
      {amoraIdentity.paths.map(path => <path key={path} d={path} />)}
    </svg>
  );
}
