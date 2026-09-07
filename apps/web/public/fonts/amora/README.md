# Amora fonts

The user supplied five Amora desktop/mobile HTML designs on 2026-09-06.
They use Gowun Dodum Regular for display text and IBM Plex Sans KR
Regular/Medium/SemiBold/Bold for body and controls.

These self-hosted WOFF2 subsets retain complete modern Hangul syllables,
Latin, jamo, punctuation, symbols and full-width forms from the upstream fonts.
They support dynamic Korean user content instead of only current UI copy.
Other scripts use the existing Paperlogy/system fallback.

Sources: Google Fonts [Gowun Dodum](https://github.com/google/fonts/tree/main/ofl/gowundodum)
and [IBM Plex Sans KR](https://github.com/google/fonts/tree/main/ofl/ibmplexsanskr).
Complete SIL Open Font License notices are included. Modified internal names
are Hanbang Amora Display and Hanbang Amora Body; reserved upstream family
names are not used for the modified files.

To regenerate with FontTools, retain name records, subset to U+0020–024F,
U+1100–11FF, U+2000–26FF, U+3000–318F, U+AC00–D7A3, U+FF00–FFEF,
rename name IDs 1/3/4/6/16/21 consistently and save with WOFF2 flavor.
Keep copyright and license metadata intact.
