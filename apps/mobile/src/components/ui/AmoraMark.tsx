import Svg, { Path } from "react-native-svg";
import { amoraIdentity } from "@hanbang/design-tokens";

type AmoraMarkProps = {
  size?: number;
  color?: string;
  ring?: boolean;
};

export default function AmoraMark({ size = 24, color = amoraIdentity.ink, ring = true }: AmoraMarkProps) {
  return (
    <Svg width={size} height={size} viewBox={amoraIdentity.viewBox} fill="none"
      stroke={color} strokeWidth={amoraIdentity.strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      accessible={false} pointerEvents="none">
      {ring && <Path d={amoraIdentity.ring} />}
      {amoraIdentity.rose.map(path => <Path key={path} d={path} fill={color} stroke="none" />)}
    </Svg>
  );
}
