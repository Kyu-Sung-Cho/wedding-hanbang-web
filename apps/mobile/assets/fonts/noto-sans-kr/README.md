# Noto Sans KR (invitation design body text)

Subset of the static Google Fonts files (Noto Sans KR v40, "Version 2.004") published in the npm package
`@expo-google-fonts/noto-sans-kr@0.4.4`.
Tarball SHA-256: fabc22bd03ec09aacd59377d912cf2f453ece85ac33599654665e72b83c06861

License: SIL Open Font License 1.1, included as OFL.txt (copied from the package's LICENSE_FONT).
The name table, including the copyright, licence and reserved font name records, is kept unchanged.
The family name is unchanged; the reserved font name is 'Source', which these files do not use.

Built by `apps/mobile/scripts/subset-invitation-fonts.py`:
every modern Hangul syllable (U+AC00-D7A3, 11,172), Latin, punctuation, compatibility jamo and common
symbols. Hanja and other scripts are dropped; the platform font draws them. Hinting, glyph names and
vertical metrics are removed.

One metric is changed: the space (U+0020, U+00A0) advance is 280 units, the value in the Noto Sans KR
that Google Fonts serves to browsers (v40 web slices). The static TTF has 224, which set words closer
than the design artifact and the web app and wrapped Korean lines at different syllables.

| Weight | Original | Subset |
| --- | --- | --- |
| 400 NotoSansKR-Regular.ttf | 6,191,364 | 2,504,668 |
| 500 NotoSansKR-Medium.ttf | 6,188,880 | 2,504,428 |
| 700 NotoSansKR-Bold.ttf | 6,189,424 | 2,504,876 |
