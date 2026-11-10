# Open questions

Everything waiting on an answer, a file, or a check, in one place. Each item says what the program does until you decide. Background is in [NOTES.md](NOTES.md) and [CLAUDE.md](CLAUDE.md). When an item is settled, it moves to NOTES.md (or CLAUDE.md for project decisions) and comes off this list.

Last updated: 2026-11-10.

## Known bugs

**B1. The importer reads ⊕ or "+" inside a Repeat line as a section name.** In "Repeat Chorus (⊕last two bars)", the ⊕ (in A Dios Le Pido, a "+") is stored as a link to a section instead of ordinary text. It prints correctly, but the data is wrong, and the editor has to keep the line as raw JSON. Seen in A Dios Le Pido and Awitin Mo At Isasayaw Ko. *Fix ready to do: read it as text, then re-import those two charts.*

## Waiting on files from you

**W1. A Cubase export.** One riff from a Cubase project, exported as MusicXML and as MIDI, into `local/`. It shows whether Cubase keeps tab strings and frets. Native notation phases 2 to 4 (MIDI in, pictures in, importer) wait on it.

**W2. The filled covers and the Legend image.** 24K Magic cover, Mad World cover, the Legend image, and the 4, 5 and 7 column templates, into `samples/`. The cover look was measured from the empty templates only; these are needed for the checks in V9 to V14.

**W3. Purge the old commit on GitHub.** Ask GitHub Support to remove commit `43c9b8e` (it held sample charts with lyrics before the history was cleaned). Only you can request it.

## Questions for you

### Project

**Q1. Divider line on covers.** The templates have a line between the first row of diagrams and the rest. Does it mean primary vs. other chords? *Now: not drawn.* (CLAUDE.md §10.2)

**Q2. More than 76 diagrams.** What happens past 56 on page 1 plus 20 on page 2? *Now: the extra diagrams are left off, with a warning.* (§10.3)

**Q3. Marks not in the Legend.** What do these mean: `|` and `| -`, `(+Bnd)` / `(-Drm)`, `(NC)`, `(simile)`, `(ritard)`, the down arrow, parentheses around lyrics, stacked meter numbers, instrument abbreviations? *Now: drawn as in today's charts, with no meaning attached.* (§10.4)

**Q4. Date on the chart.** Last-saved date, or a revision date you set? *Now: the chart's `date` field.* (§10.5)

**Q5. Website.** Publish from this tool into WordPress, or replace parts of it (membership, library)? *Now: assume publishing into WordPress.* (§10.6)

**Q6. Alternate voicings on covers.** Do covers need voicing sets per instrument ("for Acoustic")? How are they chosen? *Now: a chart can list an "Alternate (for ...)" group by hand.* (§10.7)

**Q7. "Original" in the title block.** Is it a version label (e.g. for transposed versions)? *Now: printed unless the chart's `originalKey` differs from its key.* (§10.8)

**Q8. The logo in the public repo.** The Musicians' Club logo is in `assets/cover/` on GitHub. Keep it public, or move it to `local/`? *Now: public.*

### Covers and chords

**Q9. "(m)5" and "5(m)".** Are these power chords? *Now: they use the power-chord shape.*

**Q10. A bass change on the cover.** Does "/E" with no new chord need its own diagram (e.g. "C/E")? *Now: yes, one each.*

**Q11. The starter voicing library.** About 370 generated shapes in `src/voicings/library.json` need your approval; each chart lists the unapproved shapes its cover uses. Some chords have no shape yet (G and G#/Ab sus2 and 7sus2; G#/Ab 6; G#/Ab, A and A#/Bb 9). *Now: generated shapes are used, missing ones get an empty diagram.*

### Charts

**Q12. A third repeated riff.** What color? *Now: light blue is reused.*

**Q13. A fourth repeated section.** What color? *Now: purple is reused.*

**Q14. Gray "no bass" chords.** What exact gray? *Now: the lyric gray `#808080`.*

### Editor

**Q15. Watermark on exported PDFs.** What text, where, and who sees which version? *Now: no watermark.*

**Q16. Editor symbols.** The symbols authors type (`<` `>`, `!!` for stop and hold, `@1'` for the second riff color, `*` for a gray chord, `_` and `^`) are proposals. Keep or change them? See [NOTES.md](NOTES.md#chart-text-format).

**Q17. Notation in the editor.** Notation blocks are kept as raw JSON in the chart text. Want a short line format instead (e.g. `!notation riff.musicxml bars=1-2`)?

## Values to check

First guesses or measurements from too few samples. Each is in [rules/chart-rules.json](rules/chart-rules.json), so changing one needs no code change.

### Chart layout

**V1. Before/after chord spacing.** A chord just before or after a syllable sits 2 pt from it and 12 pt from the other side. Check on a real chart. (`render.spacing.timingNear` / `timingFar`)

**V2. Chord weights.** Where a chord's "middle" sits on the beat: an extension weighs 0.5 of a root letter, a slash bass 0.25. (`render.chord.extensionWeight` / `bassWeight`)

**V3. Row height.** 20 pt normally, squeezed down to 17 pt at most to keep a chart on 2 pages. (`render.row.height`, `render.squish`)

**V4. Bottom of the page.** Sections end no lower than 779 pt. (`render.page.bottomLimit`)

**V5. Lyric entering after beat 1.** 25.2 pt per beat of delay. (`render.spacing.beatWidth`)

**V6. Stacked meter numbers.** Size of inline time-signature changes. (`render.marks.meterSize`)

**V7. Notation size.** Tab lines about 7.4 pt apart, like today's Cubase snippets. Check on paper. (`notation.scale`)

**V8. Long titles.** Titles wider than 560 pt are narrowed (font size stays). (`cover.header.maxWidth`)

### Cover look (check against the filled covers, W2)

**V9. Title font.** TeX Gyre Cursor stands in for Courier New, which can't be bundled.

**V10. Last row of diagrams.** Left-aligned, like pictures pasted into Word, or centered? (`cover.columns.lastRow`)

**V11. Column scales.** 4, 5 and 7 columns (90%, 70%, 75%) are derived, not measured. (`cover.columns`)

**V12. "Continued at back of page".** Sits just under the last row on page 1, which leaves little room. (`cover.chords.continued*`)

**V13. Small details.** Logo shadow, header bar height (28 pt; the templates vary from 24 to 34), the line under the Legend footnotes, footer link position. (`cover.*`)

**V14. Page 2 margins.** Page 2 keeps the templates' 0.5 in side margins (page 1 uses 0.2 in). Make them match? (`cover.layouts`)
