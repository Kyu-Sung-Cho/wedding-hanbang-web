"""Build the invitation-design fonts that the native app bundles (2026-11-17 founder design artifact).

The design uses Gowun Batang (Korean titles, names, letters), Cormorant Garamond (numerals, dates,
wordmark) and Noto Sans KR (body). The full Google Fonts files add 37.3 MB of assets, so the app ships
subsets instead (sizes in the README next to each font):

- Noto Sans KR 400/500/700: every modern Hangul syllable (11,172) plus Latin, punctuation and the
  symbols Korean text uses. Body text shows whatever a person types, so no syllable is dropped.
  Hanja and other scripts are dropped; the platform font draws them.
- Gowun Batang 400/700: the 2,350 KS X 1001 syllables plus the same Latin and symbols. It is the
  display serif. The syllables it lacks fall back to the platform font one glyph at a time
  (iOS CoreText cascade, Android system fallback chain, browser fallback on web).
- Cormorant Garamond 400/500 and italics: Latin only (digits, dates, the "amora" wordmark).

Hinting, glyph names and vertical metrics are dropped. The name table is kept whole so the OFL
copyright and licence records stay inside every file.

One metric is changed: the Noto Sans KR space (U+0020, U+00A0) gets the 280-unit advance of the font
Google Fonts serves to browsers (v40 web slices, all three weights). The static v40 TTF has 224 units,
so without this the app set words about 1px closer at 17px than the artifact (which the founder viewed
in Chrome) and the Next.js web app, and Korean lines wrapped at different syllables. Measured
2026-11-17 by drawing ten spaces at 100px in headless Chrome: web 28.0px, static TTF 22.4px.

Sources are the static TTFs in the npm packages @expo-google-fonts/gowun-batang@0.4.1,
@expo-google-fonts/cormorant-garamond@0.4.1 and @expo-google-fonts/noto-sans-kr@0.4.4, unpacked with
`npm pack <name>@<version>` and `tar -xzf <tarball> -C <dir>` into x-gowun-batang/, x-cormorant-garamond/
and x-noto-sans-kr/ under one folder.

Usage (fontTools 4.x): python scripts/subset-invitation-fonts.py <unpacked-root> assets/fonts
"""
import os
import shutil
import sys

from fontTools import subset
from fontTools.ttLib import TTFont


def code_points(*pairs):
    points = set()
    for start, end in pairs:
        points.update(range(start, end + 1))
    return points


# Latin, general punctuation, won/euro signs, letterlike and number forms, arrows, math, circled
# numbers, shapes, symbols, dingbats, CJK punctuation, compatibility jamo (ㅋ, ㅠ), parenthesized and
# circled Hangul, fullwidth ASCII and fullwidth signs (￦).
KOREAN_TEXT_SYMBOLS = code_points(
    (0x0020, 0x007E), (0x00A0, 0x00FF),
    (0x2000, 0x206F), (0x20A9, 0x20A9), (0x20AC, 0x20AC),
    (0x2100, 0x214F), (0x2150, 0x218F), (0x2190, 0x21FF), (0x2200, 0x22FF),
    (0x2460, 0x24FF), (0x25A0, 0x25FF), (0x2600, 0x26FF), (0x2700, 0x27BF),
    (0x3000, 0x303F), (0x3131, 0x318E), (0x3200, 0x321E), (0x3260, 0x327F),
    (0xFF01, 0xFF5E), (0xFFE0, 0xFFE6),
)
ALL_HANGUL_SYLLABLES = code_points((0xAC00, 0xD7A3))
# KS X 1001 syllables are exactly the ones EUC-KR encodes in two bytes.
KSX1001_HANGUL_SYLLABLES = {cp for cp in ALL_HANGUL_SYLLABLES if len(chr(cp).encode("euc_kr")) == 2}
LATIN_NUMERALS = code_points(
    (0x0020, 0x007E), (0x00A0, 0x00FF), (0x2000, 0x206F), (0x20A0, 0x20CF), (0x2100, 0x214F),
)

FACES = [
    # (folder, output file, unpacked source, code points)
    ("noto-sans-kr", "NotoSansKR-Regular.ttf", "x-noto-sans-kr/package/400Regular/NotoSansKR_400Regular.ttf",
     KOREAN_TEXT_SYMBOLS | ALL_HANGUL_SYLLABLES),
    ("noto-sans-kr", "NotoSansKR-Medium.ttf", "x-noto-sans-kr/package/500Medium/NotoSansKR_500Medium.ttf",
     KOREAN_TEXT_SYMBOLS | ALL_HANGUL_SYLLABLES),
    ("noto-sans-kr", "NotoSansKR-Bold.ttf", "x-noto-sans-kr/package/700Bold/NotoSansKR_700Bold.ttf",
     KOREAN_TEXT_SYMBOLS | ALL_HANGUL_SYLLABLES),
    ("gowun-batang", "GowunBatang-Regular.ttf", "x-gowun-batang/package/400Regular/GowunBatang_400Regular.ttf",
     KOREAN_TEXT_SYMBOLS | KSX1001_HANGUL_SYLLABLES),
    ("gowun-batang", "GowunBatang-Bold.ttf", "x-gowun-batang/package/700Bold/GowunBatang_700Bold.ttf",
     KOREAN_TEXT_SYMBOLS | KSX1001_HANGUL_SYLLABLES),
    ("cormorant-garamond", "CormorantGaramond-Regular.ttf",
     "x-cormorant-garamond/package/400Regular/CormorantGaramond_400Regular.ttf", LATIN_NUMERALS),
    ("cormorant-garamond", "CormorantGaramond-Medium.ttf",
     "x-cormorant-garamond/package/500Medium/CormorantGaramond_500Medium.ttf", LATIN_NUMERALS),
    ("cormorant-garamond", "CormorantGaramond-Italic.ttf",
     "x-cormorant-garamond/package/400Regular_Italic/CormorantGaramond_400Regular_Italic.ttf", LATIN_NUMERALS),
    ("cormorant-garamond", "CormorantGaramond-MediumItalic.ttf",
     "x-cormorant-garamond/package/500Medium_Italic/CormorantGaramond_500Medium_Italic.ttf", LATIN_NUMERALS),
]

# Space advance of the Noto Sans KR that Google Fonts serves to browsers (see the module docstring).
NOTO_WEB_SPACE_ADVANCE = 280

LICENSES = [
    ("noto-sans-kr", "x-noto-sans-kr/package/LICENSE_FONT"),
    ("gowun-batang", "x-gowun-batang/package/LICENSE_FONT"),
    ("cormorant-garamond", "x-cormorant-garamond/package/LICENSE_FONT"),
]


def subset_options():
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.glyph_names = False
    options.hinting = False
    options.drop_tables += ["vhea", "vmtx", "VORG"]
    return options


def build(source_root, fonts_root):
    for folder, output, source, points in FACES:
        target_dir = os.path.join(fonts_root, folder)
        os.makedirs(target_dir, exist_ok=True)
        # 원본의 수정 시각을 그대로 둬 같은 입력이면 같은 바이트가 나오게 한다.
        font = TTFont(os.path.join(source_root, source), recalcTimestamp=False)
        subsetter = subset.Subsetter(options=subset_options())
        subsetter.populate(unicodes=sorted(points))
        subsetter.subset(font)
        if folder == "noto-sans-kr":
            cmap = font.getBestCmap()
            for code_point in (0x0020, 0x00A0):
                glyph = cmap[code_point]
                _, left_side_bearing = font["hmtx"][glyph]
                font["hmtx"][glyph] = (NOTO_WEB_SPACE_ADVANCE, left_side_bearing)
        target = os.path.join(target_dir, output)
        font.save(target)
        font.close()
        print(f"{folder}/{output}: {os.path.getsize(target):,} bytes")
    for folder, source in LICENSES:
        shutil.copyfile(os.path.join(source_root, source), os.path.join(fonts_root, folder, "OFL.txt"))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: subset-invitation-fonts.py <unpacked-root> <assets/fonts>")
    build(sys.argv[1], sys.argv[2])
