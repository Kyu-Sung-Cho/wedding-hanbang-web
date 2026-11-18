import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, RadialGradient, Rect, Stop } from "react-native-svg";
import { amoraOrb, type AmoraOrbMood } from "@hanbang/design-tokens";

type AmoraOrbProps = {
  /** 가로세로 크기. 아티팩트는 150·110·64·44·40·36·32 를 쓴다. */
  size?: number;
  /** `working` 이면 더 빨리 돈다. `happy` 는 모양이 `calm` 과 같다(아티팩트 그대로). */
  mood?: AmoraOrbMood;
  /** 옆에 아모라 이름이 이미 있으면 읽어 주는 이름을 두 번 말하지 않게 숨긴다. */
  decorative?: boolean;
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

type GradientName = keyof typeof amoraOrb.gradients;

const C = amoraOrb.center;

function Gradients({ names, prefix }: { names: readonly GradientName[]; prefix: string }) {
  return (
    <>
      {names.map((name) => {
        const gradient = amoraOrb.gradients[name];
        return (
          <RadialGradient key={name} id={`${prefix}-${name}`} cx={gradient.cx} cy={gradient.cy} r={gradient.r}>
            {gradient.stops.map(([offset, color, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
            ))}
          </RadialGradient>
        );
      })}
    </>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (alive) setReduce(value); })
      .catch(() => { /* 설정을 못 읽으면 움직임을 그대로 둔다 */ });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => { alive = false; subscription.remove(); };
  }, []);
  return reduce;
}

type LoopBuilder = (value: Animated.Value, ms: number) => Animated.CompositeAnimation;

function useLoop(value: Animated.Value, seconds: number, enabled: boolean, build: LoopBuilder) {
  useEffect(() => {
    if (!enabled) {
      value.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(build(value, seconds * 1000));
    loop.start();
    return () => loop.stop();
  }, [value, seconds, enabled, build]);
}

/**
 * 폰에서는 네이티브 드라이버가 반복을 맡는다. 웹(react-native-web 0.21)에는 그 모듈이 없어 JS 로 대신 도는데,
 * `useNativeDriver: true` 인 채로 `Animated.loop` 에 넣으면 '네이티브 반복' 길로 빠져 반복 횟수를 버리고
 * 한 바퀴만 돌고 멈춘다(2026-11-17 앱 웹 내보내기에서 실측: 일하는 중 구슬이 4초 안에 섰다).
 * 웹에서만 꺼서 JS 반복 길로 보낸다. 폰은 그대로 네이티브 드라이버다.
 */
const USE_NATIVE_DRIVER = Platform.OS !== "web";

const spin: LoopBuilder = (value, ms) =>
  Animated.timing(value, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: USE_NATIVE_DRIVER });

const breathe: LoopBuilder = (value, ms) =>
  Animated.sequence([
    Animated.timing(value, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: USE_NATIVE_DRIVER }),
    Animated.timing(value, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: USE_NATIVE_DRIVER }),
  ]);

/**
 * 아모라 오브(네이티브) — 청첩장 디자인(2026-11-17)의 아모라 모습.
 *
 * 웹(`apps/web/src/components/ui/AmoraOrb.tsx`)과 같은 `amoraOrb` 값을 읽는다.
 * 네이티브에서는 SVG 묶음을 따로 돌릴 수 없어서, 무리마다 같은 원으로 잘린 SVG 를 한 장씩
 * 겹치고 그 장을 통째로 돌린다. 원은 돌려도 원이라 웹의 "원 안에서 도는 무리"와 같게 보인다.
 * 움직임 줄이기 설정이면 멈춘다.
 */
export default function AmoraOrb({ size = 200, mood = "calm", decorative = false }: AmoraOrbProps) {
  const reduceMotion = useReduceMotion();
  const animate = !reduceMotion;
  const seconds = mood === "working" ? amoraOrb.busySeconds : amoraOrb.calmSeconds;
  const label = mood === "working" ? amoraOrb.labels.working : amoraOrb.labels.calm;

  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  useLoop(a, seconds.a, animate, spin);
  useLoop(b, seconds.b, animate, spin);
  useLoop(c, seconds.c, animate, spin);
  useLoop(halo, seconds.halo, animate, breathe);

  const rotations = useMemo(() => ({
    a: a.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
    b: b.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] }),
    c: c.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
  }), [a, b, c]);
  const { scaleFrom, scaleTo, opacityFrom, opacityTo } = amoraOrb.breathe;
  const haloStyle = {
    opacity: animate ? halo.interpolate({ inputRange: [0, 1], outputRange: [opacityFrom, opacityTo] }) : 1,
    transform: [{ scale: animate ? halo.interpolate({ inputRange: [0, 1], outputRange: [scaleFrom, scaleTo] }) : 1 }],
  };

  const box = { width: size, height: size };
  const clip = (id: string) => (
    <ClipPath id={id}>
      <Circle cx={C} cy={C} r={amoraOrb.clipRadius} />
    </ClipPath>
  );

  return (
    <View
      style={box}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : label}
      importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}
      pointerEvents="none"
    >
      <Animated.View style={[StyleSheet.absoluteFill, haloStyle]}>
        <Svg width={size} height={size} viewBox={amoraOrb.viewBox}>
          <Defs><Gradients names={["glow"]} prefix="h" /></Defs>
          <Circle cx={C} cy={C} r={amoraOrb.halo.r} fill="url(#h-glow)" />
        </Svg>
      </Animated.View>
      <Svg width={size} height={size} viewBox={amoraOrb.viewBox} style={StyleSheet.absoluteFill}>
        <Defs>
          <Gradients names={["base"]} prefix="o" />
          {clip("o-clip")}
        </Defs>
        <G clipPath="url(#o-clip)">
          <Rect x={0} y={0} width={200} height={200} fill="url(#o-base)" />
        </G>
      </Svg>
      {amoraOrb.layers.map((layer) => {
        const prefix = `l${layer.id}`;
        const ellipses = layer.ellipses as readonly OrbEllipse[];
        const names = Array.from(new Set(ellipses.map((ellipse) => ellipse.gradient))) as GradientName[];
        return (
          <Animated.View
            key={layer.id}
            style={[StyleSheet.absoluteFill, { transform: [{ rotate: rotations[layer.id as "a" | "b" | "c"] }] }]}
          >
            <Svg width={size} height={size} viewBox={amoraOrb.viewBox}>
              <Defs>
                <Gradients names={names} prefix={prefix} />
                {clip(`${prefix}-clip`)}
              </Defs>
              <G clipPath={`url(#${prefix}-clip)`}>
                {ellipses.map((ellipse) => (
                  <Ellipse
                    key={`${ellipse.cx}-${ellipse.cy}`}
                    cx={ellipse.cx}
                    cy={ellipse.cy}
                    rx={ellipse.rx}
                    ry={ellipse.ry}
                    fill={`url(#${prefix}-${ellipse.gradient})`}
                    opacity={ellipse.opacity}
                    rotation={ellipse.rotate}
                    origin={ellipse.rotate === undefined ? undefined : `${C}, ${C}`}
                  />
                ))}
              </G>
            </Svg>
          </Animated.View>
        );
      })}
      <Svg width={size} height={size} viewBox={amoraOrb.viewBox} style={StyleSheet.absoluteFill}>
        <Defs><Gradients names={["rim"]} prefix="r" /></Defs>
        <Circle cx={C} cy={C} r={amoraOrb.rim.r} fill="url(#r-rim)" />
        <Circle
          cx={C}
          cy={C}
          r={amoraOrb.outline.r}
          fill="none"
          stroke={amoraOrb.outline.color}
          strokeOpacity={amoraOrb.outline.opacity}
          strokeWidth={amoraOrb.outline.width}
        />
      </Svg>
    </View>
  );
}
