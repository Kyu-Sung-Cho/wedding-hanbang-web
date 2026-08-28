# Gaegu

- **저작권:** Copyright 2018 The Gaegu Project Authors
- **라이선스:** SIL Open Font License 1.1 — <http://scripts.sil.org/OFL>
- **원본:** Google Fonts (<https://fonts.google.com/specimen/Gaegu>)

## 왜 자가호스팅인가

제품 CSP(`apps/web/next.config.ts` 의 `contentSecurityPolicy`)가 `font-src 'self' data:` 라
구글 폰트를 링크로 부르면 브라우저가 막는다. 그러면 손글씨가 조용히 기본 서체로 떨어진다 —
화면은 그대로 떠서 적용된 줄 착각하기 쉬운 종류의 실패다. Gaegu 는 SIL OFL 이라 자가호스팅이 허용된다.

같은 파일에 구글 폰트를 **허용하는** `saiContentSecurityPolicy` 가 따로 있는데 그건 `/sai`
전용이다. 랜딩에는 안 붙는다 — 2026-08-27 응답 헤더 실측으로 확인했다
(`curl -I /landing` → `font-src 'self' data:`).

## 어디에 쓰나

랜딩(`/landing`, `/`)의 **짧은 손글씨 강조만** — 섹션 머리말, 워드마크, 큰 숫자.
본문·제목·버튼·작은 글씨는 전부 Paperlogy 다. `DESIGN.md` 의 Typography 절 참고.
**제품 화면에서는 쓰지 않는다.**

## 서브셋

원본은 굵기당 약 3MB 라 그대로 실을 수 없다. 랜딩에서 실제로 쓰는 글자만 남긴다.

```bash
python scripts/subset-gaegu.py
```

글자 목록은 랜딩 카피에서 뽑는다. **카피를 고치면 다시 돌려야 한다** —
안 돌리면 새로 쓴 글자가 서브셋에 없어 그 글자만 다른 서체로 떨어진다.
