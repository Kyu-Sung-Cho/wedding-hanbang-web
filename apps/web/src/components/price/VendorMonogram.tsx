// 업체 모노그램 아바타 — 외부 로고를 긁어오지 않는다(상표권·오배정 리스크).
// 이니셜 + 벤더 id 기반 결정론 색상(라운지 팔레트)으로 항상 정확하고 일관된 식별을 준다.
const PALETTE = [
  { bg: "#36534E", fg: "#FBF8F2" }, // 유칼립투스
  { bg: "#8F6662", fg: "#FBF8F2" }, // 더스티 모브
  { bg: "#B89785", fg: "#243832" }, // 골드
  { bg: "#4E6A62", fg: "#FBF8F2" }, // 세이지 딥
  { bg: "#EFE4D7", fg: "#36534E" }, // 아이보리 딥
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(0 + index)) >>> 0;
  }
  return hash;
}

/** 괄호 접두([강릉]·(주) 등)를 건너뛰고 상호의 첫 글자를 고른다. */
function monogramChar(name: string): string {
  const stripped = name
    .replace(/^[[(][^\])]{1,8}[\])]\s*/u, "")
    .replace(/^(?:\(주\)|㈜|\(유\)|주식회사)\s*/u, "")
    .trim();
  return (stripped || name).slice(0, 1).toUpperCase() || "웨";
}

export function VendorMonogram({
  id,
  name,
  size = "md",
}: {
  id: string;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const color = PALETTE[hashString(id) % PALETTE.length];
  const sizeClass = size === "lg"
    ? "size-14 text-2xl"
    : size === "sm"
      ? "size-8 text-sm"
      : "size-10 text-lg";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-2xl font-bold ${sizeClass}`}
      style={{ backgroundColor: color.bg, color: color.fg }}
    >
      {monogramChar(name)}
    </span>
  );
}
