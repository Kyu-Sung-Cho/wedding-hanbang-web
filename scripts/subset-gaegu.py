# -*- coding: utf-8 -*-
"""랜딩 손글씨(Gaegu)를 실제로 쓰는 글자만 남겨 자가호스팅용으로 굽는다.

    python scripts/subset-gaegu.py

## 왜 자가호스팅인가

제품 CSP(`apps/web/next.config.ts` 의 `contentSecurityPolicy`)가 `font-src 'self' data:` 라
구글 폰트를 링크로 부르면 브라우저가 막는다. 그러면 손글씨가 조용히 기본 서체로 떨어진다 —
화면은 그대로 떠서 적용된 줄 착각하기 쉬운 종류의 실패다. Gaegu 는 SIL OFL 이라 자가호스팅이 허용된다.

같은 파일에 구글 폰트를 **허용하는** `saiContentSecurityPolicy` 가 따로 있는데 그건 `/sai`
전용이다. 랜딩에는 안 붙는다 — 2026-08-27 응답 헤더 실측으로 확인했다
(`curl -I /landing` → `font-src 'self' data:`).

## 글자 목록을 어디서 뽑나

`landingContent.ts` 의 문자열 전부 + 랜딩 컴포넌트의 손글씨 리터럴.

처음엔 `landing-hand` 가 붙은 자리의 **리터럴 텍스트만** 긁었다. 그런데 카드 제목은
`{item.title}` 이라 JSX 표현식이고 값은 landingContent.ts 에 있다 — 그 글자들이
서브셋에서 통째로 빠졌다. 손글씨로 안 나가는 글자까지 넣는 게 낭비 같지만 한국어
음절은 겹치는 게 많아 몇 KB 차이고, **빠진 글자는 눈으로 잘 안 보인다.**

**카피를 고치면 다시 돌려야 한다.**

## 원본에 없는 글자는 못 만든다

서브셋 목록에 넣어도 원본 폰트에 글리프가 없으면 안 생긴다. ①~⑦ 이 그랬고,
브라우저가 그 글자만 다른 서체로 그려서 한 줄 안에서 서체가 갈렸다.
아래 `missing` 보고를 보고, 나오는 글자는 카피에서 빼거나 손글씨를 벗긴다.
"""
import glob
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from fontTools import subset, ttLib  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'apps', 'web', 'public', 'fonts', 'gaegu')
REDESIGN = os.path.join(ROOT, 'apps', 'web', 'src', 'components', 'landing', 'redesign')

# 컴포넌트에서 손글씨로 나가는 리터럴을 뽑는 정규식. `{` `}` 가 든 조각은 표현식이라 건너뛴다.
# 문자열 리터럴 하나를 뽑는 정규식. 이스케이프를 두 번 적지 않으려고 상수로 둔다.
STR_LITERAL = r'"((?:[^"\\]|\\.)*)"'

HAND_LITERAL = re.compile(r'landing-hand[^>]*>\s*([^<{}]{1,120}?)\s*<')

text = ''

# 1) 카피 정본의 문자열 전부. 주석은 뺀다 — 화면에 안 나간다.
src = io.open(os.path.join(REDESIGN, 'landingContent.ts'), encoding='utf-8').read()
src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
src = re.sub(r'//[^\n]*', '', src)
for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', src):
    text += m.group(1)

# 2) 컴포넌트에 직접 적힌 손글씨 리터럴. `{` `}` 가 든 조각은 표현식이라 건너뛴다.
for f in glob.glob(os.path.join(REDESIGN, '*.tsx')):
    s = io.open(f, encoding='utf-8').read()
    for m in re.finditer(HAND_LITERAL, s):
        text += m.group(1)

# 3) 어느 카피에도 안 걸리지만 화면에 뜰 수 있는 것 — 워드마크·숫자·문장부호
text += '웨딩한방0123456789.,·-—()~%원건곳편장면개월일년'

wanted = {c for c in text if c.isprintable() and not c.isspace()}

# 원본 폰트가 실제로 가진 글자만 남긴다
have = set()
# `.landing-hand` 가 font-weight 700 고정이라 700만 굽는다. 400 을 같이 구우면
# 아무도 안 쓰는 25KB 가 따라온다. 본문 굵기 손글씨가 필요해지면 여기 되돌린다.
for weight in (700,):
    p = os.path.join(SRC, 'gaegu-%d.ttf' % weight)
    if not os.path.exists(p):
        raise SystemExit('원본이 없다: %s\nGoogle Fonts 에서 받아 두어라 — LICENSE.md 참고.' % p)
    f = ttLib.TTFont(p)
    have |= {chr(cp) for cp in f.getBestCmap()}
    f.close()

missing = sorted(wanted - have)
chars = ''.join(sorted(wanted & have))
print('카피에서 뽑은 글자 %d자 · 폰트에 있는 것 %d자' % (len(wanted), len(chars)))

# 손글씨로 **실제로 나가는** 글자만 따로 모아 경고한다.
#
# 처음에는 카피 전체(손글씨로 안 나가는 것 포함)를 기준으로 경고했다. 그러면 경고가
# 늘 떠 있어서 아무도 안 읽는다 — 실제로 가운뎃점이 손글씨 라벨 세 곳에 쓰이고 있는데
# 내가 그 경고를 보고도 넘겼다. 지금은 손글씨 자리에 없는 글자면 경고하지 않는다.
hand = ''
for f in glob.glob(os.path.join(REDESIGN, '*.tsx')):
    src_tsx = io.open(f, encoding='utf-8').read()
    for m in re.finditer(HAND_LITERAL, src_tsx):
        hand += m.group(1)
# 손글씨로 나가는 카피 키의 값. 위에서 뽑아 둔 문자열 목록을 다시 쓴다 —
# 정규식을 두 번 적으면 두 곳이 어긋난다.
for key in ('eyebrow', 'proposeLabel', 'saidLabel', 'scene'):
    for line in src.split(chr(10)):
        if line.strip().startswith(key + ':'):
            found = re.search(STR_LITERAL, line)
            if found:
                hand += found.group(1)

hand_missing = sorted({c for c in hand if c in set(missing)})
if hand_missing:
    print('  ⚠ **손글씨 자리에 있는데 원본 폰트에 없는 글자**: %s' % ''.join(hand_missing))
    print('    그 글자만 다른 서체로 그려진다. 카피에서 빼거나 손글씨를 벗겨라.')
elif missing:
    print('  (원본에 없는 글자 %d개: %s — 손글씨 자리에는 없으니 문제되지 않는다)'
          % (len(missing), ''.join(missing)))

made = []
for weight in (700,):
    src_path = os.path.join(SRC, 'gaegu-%d.ttf' % weight)
    dst = os.path.join(SRC, 'gaegu-%d.woff2' % weight)
    subset.main([src_path, '--text=%s' % chars, '--output-file=%s' % dst,
                 '--flavor=woff2', '--layout-features=*', '--no-hinting', '--desubroutinize'])
    a, b = os.path.getsize(src_path), os.path.getsize(dst)
    made.append(b)
    print('  %d  %.0f KB → %.1f KB  (%.1f%% 감축)' % (weight, a / 1024, b / 1024, (1 - b / a) * 100))

print('\n합계 %.1f KB' % (sum(made) / 1024))
print('globals.css 의 @font-face 가 /fonts/gaegu/gaegu-700.woff2 를 가리킨다.')
