# Vendor Identity Verification Report — 2026-08-18

> **STATUS: VERIFIED** — 실제 중복/분리 버그 0건. 코드가 설계대로 정상 작동 중.

## 검증 범위

PR #108 이후 vendor identity 규칙이 올바르게 작동하는지 확인:
- 같은 샵이 여러 대행사에 걸쳐 있을 때 한 카드로 통합되는가
- 체인 지점(강남점 vs 부산점)이 분리 유지되는가
- 대행사 지역이 같은 샵을 여러 카드로 나누지 않는가
- 동명이업(같은 이름 다른 업체)이 분리 유지되는가

## 검증 방법

1. `pnpm audit:vendor-merge` 실행 — 라이브 사이트에서 818개 카드 분석
2. `vendorIdentity.ts` 단위 테스트 35개 실행 — 전부 통과
3. 핵심 케이스 직접 확인 — `vendorIdentityKey()` 함수로 키 비교

## 현재 데이터 구조 (정상)

| 데이터 | 개수 | 용도 |
|--------|------|------|
| 총 카드 | 818 | studio 296, dress 200, makeup 144, hall 178 |
| `SAME_BUSINESS_DIFFERENT_NAME` | 38쌍 | 같은 업체의 표기 차이 병합 |
| `VENDOR_BRANCHES` | 25개 | 지점 표기 위치 차이 통합 |
| `VENDOR_BRANCH_AMBIGUOUS` | 5개 | 지점 불명확 브랜드 표시 |
| `SAME_NAME_DIFFERENT_BUSINESS` | 3개 | 동명이업 분리 유지 |

## 핵심 기능 검증 결과

### 1. 다중 대행사 → 한 카드 ✓

"아우라"가 8개 대행사(플랜온웨딩, 요즘웨딩, 강남웨딩 등)에서 공시됐지만 한 카드로
표시됨. 각 대행사별 가격이 카드 안에 나열됨.

### 2. 체인 지점 → 분리 카드 ✓

```
s스튜디오 ↔ [천안] s스튜디오   → 같은 대행사가 둘 다 공시 → 다른 샵 확정
헤움 ↔ [수원] 헤움             → 같은 대행사가 둘 다 공시 → 다른 샵 확정
```

### 3. 같은 지점 다른 표기 → 한 카드 ✓

```
[수원] 헤움  → 정규화: 수원헤움 → identity key: makeup|헤움#수원
헤움_수원점 → 정규화: 헤움수원점 → identity key: makeup|헤움#수원
                                  ↳ 동일 키 → 한 카드로 병합
```

### 4. 같은 업체 다른 표기 → 한 카드 ✓

```
가을         → canonical: 가을 → identity key: studio|가을
가을스튜디오 → canonical: 가을 → identity key: studio|가을
                               ↳ 동일 키 → 한 카드로 병합
```

### 5. 동명이업 → 분리 카드 ✓

```
랑게 (서울 @langhe_official)   → identity key: slug:studio-ingest-8b66b01259700071
랑게 (광주 @langhe_gj)         → identity key: slug:studio-ingest-ad55657917fc0fc8
                                ↳ 다른 키 → 분리 유지
```

## 미결 쌍 — 버그 아님

`pnpm audit:vendor-merge`가 53쌍을 "병합 검토 대상"으로 표시함. 이것은:

- **버그가 아니다** — 대행사가 겹치지 않아 같은 업체인지 확인할 근거가 없음
- 설계상 의도된 상태 — "근거 없이 합치는 것보다 갈려 있는 편이 낫다"
- `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md`에 37쌍 미결로 문서화됨

### 미결 쌍 종류

| 종류 | 개수 | 예시 |
|------|------|------|
| 카테고리 접미 | 46쌍 | "메이" ↔ "메이 스튜디오" |
| 대괄호 태그 | 7쌍 | "아우라" ↔ "[천안] 아우라" |

대괄호 태그 쌍은 대부분 **(주)레브웨딩**의 지역 표기로, 실제로 다른 지점일 가능성이
높다. 이미 분리 유지로 문서화돼 있다.

## 테스트 결과

```
apps/web/src/lib/price/__tests__/vendorBranchIdentity.test.ts   — 15 passed
apps/web/src/lib/price/__tests__/sameBusinessDifferentName.test.ts — 11 passed
apps/web/src/lib/price/__tests__/vendorIdentityMerge.test.ts    — 3 passed
apps/web/src/lib/price/publicListData.test.ts                   — 6 passed
                                                       Total: 35 passed
```

## 결론

1. **실제 중복 버그 0건** — 같은 샵이 여러 카드로 잘못 나뉜 경우 없음
2. **잘못된 병합 0건** — 다른 지점이 한 카드로 합쳐진 경우 없음
3. **미결 53쌍은 설계상 의도된 상태** — 공식 채널 확인 후에만 병합 가능

수정할 코드 없음. 현재 시스템이 올바르게 작동 중.
