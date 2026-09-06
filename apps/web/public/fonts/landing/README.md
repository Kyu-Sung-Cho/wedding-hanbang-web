# Landing font subsets

The user approved the desktop/mobile HTML reference on 2026-09-06. These fonts
are scoped to the marketing landing; product screens continue to use Paperlogy.

- Display: [Gowun Dodum](https://github.com/google/fonts/tree/main/ofl/gowundodum), Regular.
- Body: [IBM Plex Sans KR](https://github.com/google/fonts/tree/main/ofl/ibmplexsanskr), Regular, Medium, SemiBold, Bold.
- Hero tape: [Gaegu](https://github.com/google/fonts/tree/main/ofl/gaegu), Bold.
- The respective SIL Open Font License notices are included beside the fonts.

These are WOFF2 subsets of the upstream TTF files, generated with FontTools
using `glyphs.txt` (landing copy, component text, printable ASCII and Korean jamo).
The handwriting font is further limited to the hero tape and printable ASCII.
Modified internal families are `Hanbang Landing Display`, `Hanbang Landing Body`, and `Hanbang Landing Hand`;
the upstream reserved font name is not used as the modified font's family name.
CSS aliases are local identifiers. Preserve copyright and license metadata.

When adding landing copy, extend `glyphs.txt` and regenerate the subsets from
the upstream originals using FontTools subset with retained name records,
renamed families and WOFF2 flavor. Keep the complete notices with distributions.
Paperlogy is the fallback for any character outside the subset.
