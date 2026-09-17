import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { amoraIdentity } from "@hanbang/design-tokens";
import AmoraAvatar from "./AmoraAvatar";
import AmoraMark from "./AmoraMark";

/**
 * 아모라 표식 — 고리 안의 8방위 나침반 별(2026-09-17).
 *
 * 파운더가 맞물린 반지 대신 나침반을 골랐다. 원문: "안내자라 나침반 어떤가 해서".
 * 배치 근거는 `packages/design-tokens/src/amora.ts` 에 있다. 여기서는 그 근거 중
 * 되돌아오기 쉬운 두 가지를 지킨다 — 14px 에서 별이 고리에 붙지 않는 간격, 그리고
 * 아바타에서 원이 두 겹이 되지 않는 것.
 */

const CENTER = 12;
const MIN_GAP = 1.5;

// React 19 는 `<path …></path>` 로 닫는다. 속성 목록 전체를 잡아 둘을 가른다.
function pathsWithAttributes(html: string, attributes: string): string[] {
  return [...html.matchAll(/<path d="([^"]+)"([^>]*?)\/?>/gu)]
    .filter(match => match[2].trim() === attributes)
    .map(match => match[1]);
}

const strokedPaths = (html: string) => pathsWithAttributes(html, "");
const filledPaths = (html: string) => pathsWithAttributes(html, 'fill="currentColor" stroke="none"');

function vertices(path: string): Array<[number, number]> {
  const numbers = (path.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  return points;
}

function ringRadius(path: string): number {
  const match = /^M ([\d.]+) ([\d.]+) a ([\d.]+) \3 0 1 0 ([\d.]+) 0 a \3 \3 0 1 0 -\4 0$/u.exec(path);
  expect(match, `고리 경로 형식이 바뀌었다: ${path}`).not.toBeNull();
  const [, startX, startY, radius] = match!.map(Number);
  expect(startX + radius).toBeCloseTo(CENTER);
  expect(startY).toBe(CENTER);
  return radius;
}

describe("아모라 나침반 표식", () => {
  it("선으로 그은 고리 하나와 면으로 채운 별 둘을 그린다", () => {
    const html = renderToStaticMarkup(<AmoraMark />);
    expect(html).toContain('data-amora-mark="compass"');
    expect(strokedPaths(html)).toEqual([amoraIdentity.ring]);
    expect(filledPaths(html)).toEqual([...amoraIdentity.rose]);
  });

  it("14px 에서도 별 끝이 고리 안쪽 가장자리에서 1.5 단위 넘게 떨어진다", () => {
    const halfStroke = amoraIdentity.strokeWidth / 2;
    const ring = ringRadius(amoraIdentity.ring);
    const reach = Math.max(...amoraIdentity.rose.flatMap(vertices).map(([x, y]) => Math.hypot(x - CENTER, y - CENTER)));

    expect(ring - halfStroke - reach).toBeGreaterThanOrEqual(MIN_GAP);
    // 고리 바깥 가장자리도 24 박스 안에 남는다
    expect(ring + halfStroke).toBeLessThanOrEqual(CENTER);
  });

  it("아바타는 자기 테두리를 고리로 삼아 별만 그린다", () => {
    const html = renderToStaticMarkup(<AmoraAvatar />);
    expect(html).toContain('data-amora-avatar="compass"');
    expect(strokedPaths(html)).toEqual([]);
    expect(filledPaths(html)).toEqual([...amoraIdentity.rose]);
  });
});
