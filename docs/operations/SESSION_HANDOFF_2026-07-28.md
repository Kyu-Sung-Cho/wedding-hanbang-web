# 세션 인계 — 2026-07-27~28

다른 컴퓨터에서 이어받을 때 이 문서부터 읽는다. 앞선 인계는
`CURRENT_WORKSPACE_HANDOFF_2026-07-20.md`, 직전 세션은 `LAUNCH_PREP_SESSION_2026-07-26.md`.

**무엇을 왜 어떻게 했는지의 상세 기록은 `WORK_LOG_2026-07-27_28.md`에 있다.**
이 문서는 방향 안내다.

## 이 세션이 한 일 (커밋 7개)

| 커밋 | 내용 |
|---|---|
| `6f6b0170` | CI 파손 신호 복원 — `code_quality_signal` 잡 신설 |
| `59bfc235` | 공시 라운드 드리프트 가드 + 감사 스크립트 수리 |
| `851e2417` | 업체 병합 1차 — 근거 확인 16쌍 |
| `7a3c4965` | 업체 병합 2차 — 10쌍 추가, 미결 37쌍 |
| `da283897` | 첫 화면 업체 수 502 → 412 정정 (게시 직전 발견) |
| `58238675` | 인계 문서 + 병합 판정 근거(24KB) 커밋 |
| (이 커밋) | 상세 작업 기록 `WORK_LOG_2026-07-27_28.md` |

앞부분에서 다른 컴퓨터의 29커밋(`e162f2da..fe1f47e6`)을 병합하고 **24개 전량 diff를
대조**했다. 커밋 메시지와 코드가 어긋난 건은 없었다.

## 지금 상태

- **라이브**: 업체 카드 842(studio 297 · dress 205 · makeup 150 · hall 190),
  위약금 원문 831건 · 업체 412곳, 공시 기준 시점 "2025년 11월"
- **브랜치**: `feat/vendor-disclosure-pipeline-v2-20260718` = `origin/main`
- **테스트**: 루트 계약 1,089 · 웹 vitest 338파일, 실패 0
- **CI**: `Quality Gate`는 여전히 의도적 빨간불(릴리스 차단 선언).
  **`Code Quality (breakage signal only)` 잡이 파손 신호다** — 이게 빨간불이면 뭔가 깼다는 뜻.

## 반복해서 밟은 함정 — 다음 세션이 안 밟게

이 세션에서 **"통과했지만 아무것도 증명하지 않는 검사"를 다섯 번** 만났다.
넷은 이전에 내가 만든 것이고 하나는 이 세션에서 만들다가 잡았다.

1. `Number(counts.users) === 0 || true` — **항상 참**인데 "21/22 통과"로 보고했다.
2. `/wedding/saved` 재발방지 테스트의 orphan 기대값에 **살아 있는 페이지**를 못 박아,
   가입 퍼널이 사라져도 통과하는 상태였다.
3. `successor-release-evidence-contract.test.mjs`(14건)를 만들고 **어느 스크립트에도
   등록하지 않아** 한 번도 안 돌았다.
4. `disclosure-count-consistency`는 세 표면이 **같은 숫자**를 말하는지만 봐서,
   셋이 사이좋게 틀린 값(502)을 고정하고 있었다.
5. (이 세션) 새로 만든 CI 가드가 **주석을 코드로 오판**해 통과했고,
   `if…fi` 밖의 `exit 1`을 못 잡았고, 파싱 실패 시 조용히 건너뛰었다.

**처방: 새 가드는 반드시 변이 테스트로 확인한다.** 수정을 되돌리거나 조건을 깨뜨렸을 때
**그 테스트만** 실패하는지 본다. 이 세션에서 CI 7종·공시 라운드 6종·업체 병합 8종·
공시 규모 4종을 그렇게 확인했고, 그 과정에서 내 새 코드의 결함 5개를 잡았다.

## 검증할 때 쓰는 명령

```bash
npx pnpm@11.7.0 test          # 루트 계약 + turbo test
npx pnpm@11.7.0 qa:local      # 웹·모바일 typecheck/lint/vitest/build
npx pnpm@11.7.0 audit:production   # 운영 DB 읽기 점검(.env.local 필요)
npx pnpm@11.7.0 audit:vendor-merge # 업체 병합 후보(비밀값 불필요)
npx pnpm@11.7.0 hooks:install      # pre-push 훅 — 체크아웃마다 한 번
```

⚠️ `qa:local`은 **루트 계약 테스트를 돌리지 않는다.** 그건 `pnpm test`에만 있다.
qa:local 그린만 보고 "전부 통과"로 읽지 말 것.

⚠️ **배포 확인에 `/wedding`의 `Age` 헤더를 쓰지 말 것.** force-dynamic이라 늘 0이라
배포 안 됐는데 됐다고 오판한다. **정적 경로(`/price/studio`)의 ETag 변화**로 본다.

## 저장소 밖에 있는 것 (다른 컴퓨터에 없다)

`work/`는 gitignore다. 이 세션이 쓴 것:

- `work/logo-hunt/results-*.json` (1.5MB) — 1차 로고·URL 리서치 원본 결과.
  **게시되지 않은 후보와 근거·확신도가 남아 있어** 업체 병합 2차 판정 10쌍이 전부
  여기서 나왔다. 판정에 쓴 부분만 추려
  `docs/operations/evidence/vendor-merge-evidence-2026-07-28.json`(24KB)에 커밋했다.
- `work/extracted/*.json` (19MB, 242유닛) — 공시 원본 추출물. 업체 이름 색인에 썼다.
  `data/raw` + ingest 파이프라인으로 재생성한다(`scripts/ingest/README.md`).
- `work/.env.staging` — 스테이징 자격증명.

운영 감사는 `apps/web/.env.local`(또는 형제 체크아웃)의 `SUPABASE_ACCESS_TOKEN`이
필요하다. 감사 스크립트는 **키가 든 파일을 고른다** — 존재만 보고 첫 파일을 잡지 않는다.

## 남은 일

### 사용자만 할 수 있는 것

1. **유통 글 게시** — `docs/DISTRIBUTION_POSTS_READY_2026-06-12.md`. 최우선.
   서비스는 라이브인데 유입이 없어 판정할 데이터가 안 쌓인다.
2. **Vercel 사업자 정보** — `NEXT_PUBLIC_BUSINESS_NAME` /
   `_REGISTRATION_NUMBER` / `_ADDRESS`. 없으면 개인정보처리방침에 아예 안 나온다.
3. **아모라 일일 상한** 유지/변경 결정(현재 전역 300).
4. **`Code Quality (breakage signal only)`을 GitHub 필수 상태 검사로 지정** — 저장소 설정.

### 코드로 할 수 있는 것

- **업체 병합 미결 37쌍** — `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md` 참고.
  일반 웹 검색으로는 못 닫는다(1차 리서치가 이미 `low_confidence`로 거절했고 사유가
  "2자 초단명 상호라 확정 불가"다). 업체 직접 확인이나 다음 공시 라운드가 필요하다.
- **앱 OSS 라이선스 고지 화면** — `7fe13493`이 죽은 링크를 지우면서 행을 없앴다.
  스토어 제출 전 필요.
- **공시 0건 지역 6곳**(강원·대전·광주·경상·부산·울산) — HWP 8건 수동 변환이
  커버리지를 가장 크게 올린다. 코드로는 못 넣는다.
- **릴리스 게이트 Slice 3**(컨트롤러 본체 배선), PITR 활성화, 호스티드 증거 5종 —
  상호 합의로 미뤄둔 항목.
