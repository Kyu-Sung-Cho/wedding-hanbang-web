# ⚠ 이 폴더의 문서는 사문 브랜치 기준이다 — 직접 인용 금지

여기 있는 감사 3건은 `feat/ux-polish-journey-audit` 기준으로 작성됐다.
그 브랜치는 `origin/main`보다 **332커밋 뒤처져 있고 AI 제공자도 다르다**(Anthropic vs OpenAI).

```
git rev-list --left-right --count origin/main...HEAD  →  332  6
```

| | feat/ux-polish-journey-audit | origin/main (운영) |
|---|---|---|
| AI 제공자 | Anthropic (`lib/ai/claude.ts`) | OpenAI Responses API (`lib/ai/openai.ts`) |
| `api/chat/route.ts` | 1,144줄 | 3,879줄 |
| 화면 / API | 53 / 86 | 72 / 154 |
| 예산 비율 추정 | `CATEGORY_RATIOS` 살아 있음 | 전량 제거 + 테스트로 봉인 |

## 이 문서들을 어떻게 쓰는가

**결론을 그대로 인용하지 마라.** `../브랜치정리.md` §2의 **재분류표 28건**을 봐라.
각 발견이 운영 기준으로 아직 유효한지(STILL_VALID / ALREADY_FIXED / DIFFERENT_FORM / CANNOT_VERIFY) 판정돼 있다.

요약: **ALREADY_FIXED 9 / STILL_VALID 11 / DIFFERENT_FORM 6 / CANNOT_VERIFY 2**

보존하는 이유는 조사 과정과 방법론(특히 반증 단계에서 잡힌 오류들)이 재사용 가치가 있기 때문이다.
