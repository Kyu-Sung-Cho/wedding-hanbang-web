# 웹 검색 메타데이터 보완 — 2026-09-28

공개 가격 사이트맵에 상세 canonical과 다른 별칭 URL이 함께 실렸다. 정적 페이지는 실제 내용 수정 여부와 무관하게 빌드 시각을 lastmod로 보냈고, 업체 Dataset에는 description이 없었다.

## 수정과 보존한 경계

- 원래 현재 공시 slug의 count/hash 검증을 통과한 후, 상세와 같은 identity resolver 및 코드유닛 순서로 대표 URL을 모은다. 현재 가격이 없는 공개 형제도 조회 대상이며, 선정한 대표가 상세에서 현재 가격을 찾을 수 없는 경우 실패한다.
- 전체 공개 업체 5필드만 페이지로 읽고 정확한 개수·중복·타입·행 상한을 검증한다. 같은 DB category/identity 그룹의 최소인 자기 자신만 개별 조회를 생략한다. 나머지는 기존 ILIKE·200개 후보 제한과 self 보존 규칙을 그대로 사용한다. 후보 Promise는 한 실행 안에서 공유하며 동시 조회는 4개로 제한한다.
- 검증된 수정일이 없는 정적 URL에는 lastmod를 생략한다. 업체 URL은 묶인 실제 공시일 중 가장 최신 값을 사용한다.
- Dataset description은 공시 기준 시점·출처·실제 계약 조건의 한계를 설명한다. 일반 색인 성공이나 검색 상위 노출을 보장하는 변경이 아니다.

DB/권한/공개 뷰·인증·가격 및 화면 동작은 바꾸지 않았다. 상세 resolver의 기존 장애 시 fallback은 유지하며 사이트맵은 오류를 전파한다.

## 실행 증거

관련 7파일 74개 테스트, 변경 파일 ESLint, 웹 typecheck, git diff 검사를 통과했다.

공개 anon 권한으로 실제 사이트맵 함수를 1회씩 실행했다. GET과 두 공개 뷰만 허용한 네트워크 경계에서 비공개 조회·쓰기 0을 유지했다. 첫 canonical 구현은 44,290ms/835요청, 최적화 후는 13,547ms/183요청이었다. 두 결과는 869개 URL(업체 832개), 중복 0이며 결과 JSON SHA256도 `ec903c0d8049988e44b8d3a37be046c33327ba23005b7769bdf1985248bf3e49`로 일치했다. 빌드 자리표시자 없이 실제 공개 데이터를 사용했으며 Next 프리뷰 빌드 성공과는 별도 증거다. 운영 env의 catalog 기대 hash 적용 여부까지 이 직접 실행으로 대신하지 않는다.

로컬 증거: `C:/Users/kcho1/.codex/visualizations/web-launch-20260928/seo-public-sitemap-result.json`, `seo-public-sitemap-optimized-result.json` 및 각각의 URL JSON. 측정 1회씩의 결과이며 미래 성능 보장은 아니다. 최종 PR CI·프리뷰·운영 반영은 각각 실제 결과로 확인한다.

## 검색 등록 상태

현재 로그인된 Google 계정의 Search Console에서 등록 속성이 없음을 확인했다. 다른 계정의 등록 여부는 확인하지 않았다. hanbang.ai 도메인을 등록 화면에 준비했고 소유권 연결은 사용자 확인을 기다린다. 사이트맵 제출·색인 현황·검색 실적 확인과 Naver 등록은 아직 완료되지 않았다.

공식 근거: [Google 사이트맵 작성](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [Google Dataset 필수 정보](https://developers.google.com/search/docs/appearance/structured-data/dataset), [네이버 사이트맵 제출](https://searchadvisor.naver.com/guide/request-feed).
