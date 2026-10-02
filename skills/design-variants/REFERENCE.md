# Design variants: reference

## Design system

Read these in order, and stop guessing once a source answers:

1. `AGENTS.md`, `CLAUDE.md` and any design doc they link. A chosen direction (for example, "deep-teal hero, sand buttons, rounded-xl") is binding: the variants explore inside it, not around it.
2. **Tokens**:
   ```bash
   grep -rn --include='*.css' -E '@theme|^:root|--color-|--radius|--font' src app styles 2>/dev/null | head -80
   ls tailwind.config.* tokens.json design-tokens.* 2>/dev/null
   ```
   Copy the hex or oklch values into the board's `:root` under the product's own token names (`--primary`, `--sage` and so on), so a variant's CSS reads like the product's classes.
3. **Type**: the font family and weights the app loads (`next/font`, `@font-face`, the Fonts link), and the type scale (`text-h1`, `text-lead` and similar utilities). Load the same family from Google Fonts, with only the weights the product loads. A weight the product does not ship (such as 300) shows nothing it can build.
4. **Shape**: the radius scale, border and hairline colours, shadows, and button and card variants (`components/ui/button.tsx` and the like). Recreate the button variants as board classes.
5. **Logo and icons**: the real SVG path data or file. Inline it. Use the product's icon set, never emoji.
6. **Contrast**: if the repo has a contrast test, reuse its pairs. Otherwise check every text-on-background pair for AA: 4.5:1 for body text, 3:1 for text at 24 px or larger.

## Choosing directions

Write a one-line reason for each candidate, then check it against these axes. Each variant should differ from every other on at least two of them.

| Axis         | Example values                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Layout model | split media/text, centred card, stacked list, table or grid, full-bleed image, timeline                                                  |
| Entry point  | action-first (buttons), content-first (photo or story), people-first (faces), goal-first (a question), data-first (times, prices, a map) |
| Interaction  | static, picker or tabs, filter, finder or wizard, expand-in-place                                                                        |
| Density      | calm with lots of air, standard, dense and utilitarian                                                                                   |
| Tone         | editorial, warm and personal, premium and typographic, practical and tool-like                                                           |

**The different-idea test:** describe each variant in eight words without naming colours or sizes. If two descriptions match, they are one variant.

Good spreads for a contact section: a photo-led invitation with three big actions, a goal finder that ends in a prefilled message, a typographic business card, and the faces of the people who answer. Bad spread: four "form beside channels" layouts with different backgrounds.

Include one conservative variant (the existing pattern done well) only when the user has not already rejected it.

## Board anatomy

- **Intro**: one heading naming what is being redesigned, and one line on what is real and that nothing is sent.
- **Per variant**: a number chip, a short name, and a one-line reason that says what this variant optimises for. Then a frame holding the variant at real size, full width of the board.
- **Order**: the variant you recommend first, unless the user asked for a fixed order.
- **Theme**: preview the product's real theme. If the product is light-only, set `color-scheme: light` on `:root` and say so in a CSS comment. If it has a dark theme, preview both.
- **RTL**: put `dir` and `lang` on the board wrapper when the product is RTL. Use logical properties (`margin-inline`, `text-align: start`).
- **Mobile**: each frame collapses at the product's breakpoints. Check 390 px: nothing may overflow.

## Interactions

Wire an interaction only when it is the variant's idea: a class picker, a goal finder, a day filter. Then make it complete, with real data and keyboard access (`button` with `aria-pressed`, visible focus).

- Use real outbound URLs only for the product's own channels: WhatsApp `wa.me/<number>?text=` with a prefilled message, `tel:`, `mailto:`, the product's social profiles, and Waze or Google Maps for its address.
- Forms call `event.preventDefault()` and show the success state locally.
- Compute "today" in the product's time zone (`Intl.DateTimeFormat(..., { timeZone })`) when data depends on the day.

## Asking

One single-select question. The header is a short noun ("Contact"). The question includes the board link. Each option is `n · Name`, and its description repeats the reason in one sentence. Mark a recommendation only when you have one: put it first, with "(Recommended)".

Option limits: most question tools allow 4 options plus a free-text "Other". With 5 variants, list 1-4 and add "or type 5" to the question.

## Iterating

- **"All bad"**: start the next board from new axis values. Keep nothing from the rejected round's layout models. Open the board's intro with one line on what changes this time ("four ideas that differ in what they are, not how they look").
- **"Mix 2 and 4"**: build the hybrid as a single variant, and show it next to its two parents.
- **Specific complaint** ("too white", "font is ugly", "immature"): treat it as a design-system problem, not a one-section problem. Fix the tokens, then re-show the section, and mention that the change applies site-wide.
- Version boards by file name (`contact-2.html`) so earlier links keep working.

## Implementing the pick

1. Map the variant onto existing primitives: section and band wrappers, buttons, cards and type utilities. Add a new component only for the variant's new idea, beside the code it replaces.
2. Pull data the way the app already does (cached readers, server components). Keep presentational parts synchronous and props-driven, so they can be tested without the data layer.
3. **Delete what the pick replaces**: old components, now-unused props, messages and tests. Run the repo's dead-code tool (knip or similar) and its i18n unused-key check.
4. Test the new component: an axe pass, plus one behavioural assertion per channel or interaction (link targets, prefilled message, conditional parts).
5. Run the repo's full check script, then build and screenshot the real route at 1280 and 390 px. Compare against the board, because the board is the spec.
6. One line in the design notes: the winning variant, and why it won.

## Gotchas

- **BiDi**: in RTL text, phone numbers, emails, handles (`@name`) and URLs flip or move their punctuation. Wrap each in `dir="ltr"` on the board and in the product. A joined list of mixed names (`כוח MAX · TripleFIT · HYROX`) merges into one LTR run and tears "כוח" away from "MAX". Wrap every item in `<bdi>` and keep the separators outside them.
- **Artifact limits**: one HTML page, styles inline, scripts only from the allowed CDNs, stylesheets only from Google Fonts. Local paths and `localhost` never load, so embed every image with `assets.py`.
- **Image weight**: hero images at 1400 px wide, cards at 360-450 px, faces at 160 px, JPEG quality 70. A board over a few MB loads slowly on a phone.
- **Fonts**: if the product self-hosts a font that Google Fonts lacks, embed a woff2 subset as a data URI, or say in the intro that the board falls back to a named system font.
- **Wrapped pages**: artifact hosts wrap the page in a document skeleton, so `template.html` is a fragment that starts at `<title>`. `shoot.mjs` wraps it the same way and writes `preview.html` for opening locally.
- **Stale servers**: when you verify the implementation, build and serve on a free port. Don't trust a long-running dev server that may hold old config, and don't kill one you did not start.
