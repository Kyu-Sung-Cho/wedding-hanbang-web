# 알려진 마이너 이슈 (2026-06-10 적대적 리뷰 잔여분)

> **폐기된 역사 문서 — 현재 구현·로드맵·마케팅·세일즈 근거로 사용 금지.** 아래 문제·해법·검증 통과 목록은 과거 백로그이며 현재 미해결 이슈나 작업 지시로 사용하지 않는다. 현재 제공 범위는 [`WEDDINGHANBANG_SERVICE_DOC.md`](../WEDDINGHANBANG_SERVICE_DOC.md), 현재 상태는 [`PROJECT_STATUS.md`](../PROJECT_STATUS.md), 제품 판단 원칙은 [`CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md`](./CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md)만 따른다.

> **역사 백로그**: 아래 상태와 “검증 통과” 주장은 2026-06-10 스냅샷이다. 현재 남은 출시 이슈와 해결 상태는 `CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md`를 우선한다.

> 4관점 리뷰(유저매트릭스/버그헌트/회귀/보안)에서 나온 minor/info 15건 중 미수정분.
> critical/major 5건은 전부 수정 완료(커밋 7a172c20). 아래는 다음 세션 백로그.

## minor (동작 영향 있음, 빈도 낮음)
1. **모멘트 일정 변경 시 구 날짜 이벤트 잔존** — 날짜를 바꾸면 (momentType, 구날짜) 이벤트가 남아 취소된 날짜로 D-3/D-1 발화 가능. 해법: log_wedding_event에 "변경" 의도 시 구 이벤트 제거, 또는 일정 화면에서 momentType 이벤트 편집 노출. (`utils/scheduleEvents.ts`)
2. **모바일 앱 일정 수정 시 momentType 소실** — 모바일 일정 편집이 이벤트 객체를 재구성하며 momentType/id/createdAt 누락 → 모멘트 루프 조용히 꺼짐. 모바일 편집 코드에 필드 보존 필요. (`apps/mobile/app/schedule/index.tsx`)
3. **글 수정 모드에서 가격 폼 미동작** — 기존 price_data가 폼에 안 뜨고, 수정 중 입력해도 저장 안 됨(작성 시에만 전송). (`post/write/page.tsx`)

## info (개선 권장)
4. 운영자 핀 API 호출 UI 없음 — 당분간 curl/Postman으로 사용: `PATCH /api/admin/posts/{id}/pin` body `{"is_pinned":true}`. admin 페이지 버튼 추가 권장.
5. proactive가 mutating GET — POST 전환 + 미들웨어 검토 권장(현재 위험도 낮음: 본인 couple에만 insert, dedupe 차단).
6. progress.__events 무한 증가 한도 없음 — 이벤트 수 상한(예: 200) 추가 권장.
7. 킬스위치 작동 시 cron 라우트가 500+영문 메시지 — 200 + 한글 안내로 정리 권장.
8. ServiceCTA prefill URL 최대 ~6-7KB — 동작은 하나 비로그인→로그인 리다이렉트 시 prefill 유실(기존 동작).
9. 대시보드 진입이 휴면 lifecycle 메시지도 깨움 — 의도된 동작이나 발화 빈도 모니터링.
10. WeeklyCard 브리핑 문구와 채팅 실상태 불일치 가능(데모/proactive 실패 시) — 문구를 "채팅에서 확인해요" 수준으로 유지 중.

## 검증 통과 확인된 것 (34건 — 대표)
- 비로그인/신규/데모/솔로커플/파트너/모바일 6개 유저 상태에서 대시보드·proactive·글상세·동기방 안전
- /market-prices 구 URL·사이드바 링크 redirect+rewrite 정상, weddingPath 멱등
- AiComment 생성기 전 필드 보장, cohort POST own-row 반환 안전, 모바일은 contracts API 미사용
- 마이그레이션 미적용 상태에서도 앱 무손상(견적 신규 필드 저장만 스킵)
