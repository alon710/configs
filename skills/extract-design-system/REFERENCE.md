# Extract design system: reference

- [Tokens](#tokens)
- [README](#readme)
- [Components](#components)
- [Publishing](#publishing)
- [Re-sync](#re-sync)
- [Gotchas](#gotchas)

## Tokens

`tokens.json` uses the type's list shape, never a name-to-value map. Every family except `type` is `{"tokens": [{"name", "value", "usage"}]}`, and `color` also carries `themes`. The type's `format.md` has the full grammar. `check.mjs` reports every value the page would drop.

### Where the values live

| Stack | Read | Notes |
| --- | --- | --- |
| Any CSS custom properties | Every stylesheet with `:root`, `.dark`, `[data-theme=…]` or `prefers-color-scheme` blocks | `css-to-tokens.mjs` handles these. The root block is the first theme. Component-scoped variables are skipped and counted. |
| Tailwind v4 | `@theme` literals become tokens. `@theme inline { --color-x: var(--x) }` aliases are dropped as duplicates. `@utility shadow-*` blocks become shadows. | Pass `node_modules/tailwindcss/theme.css` to `--resolve` so references to the default palette and scale resolve to exact values. |
| Tailwind v3, or v4 with `@config` | `tailwind.config.*` `theme.extend`: colors, borderRadius, boxShadow, fontSize, fontFamily, spacing | Read it by hand. Entries that point at CSS variables (`hsl(var(--primary))`) are already covered. Add literal entries under the config's own names (`brand-500`). |
| shadcn | `components.json` → its CSS file | Bare HSL channels (`222 47% 11%`) are wrapped in `hsl()`. `calc(var(--radius) - 4px)` is evaluated, with rem converted to px at 16px when units mix. |
| CSS-in-JS and theme objects (MUI, Chakra, styled-components, vanilla-extract, Panda) | The theme file the scan lists | Flatten nested keys with `-` (`palette.primary.main` → `primary-main`). A light/dark palette pair becomes two themes. |
| DTCG `*.tokens.json` | The file | Turn every `$value` map into lists. Resolve `{a.b}` references to the type's `{a-b}` alias form. |

Theme order: the light or root theme comes first, because a token with no value in a later theme inherits the first theme's value.

### Usage notes

Every token needs one. A good note says where the token is used and, for text, which grounds it reads on:

- `foreground`: "Body text and icons on `background`, `card` and `popover`."
- `border`: "Inputs, selects and outline buttons; card edges."
- `primary`: "The one accent: primary buttons, the current tab, focus rings and links. Text on it is `primary-foreground`."

`check.mjs` reads "on `a`, `b`" (backticks optional) and checks each pair in every theme. It also pairs `x-foreground` with `x`, `on-x` with `x`, and `foreground` with `background`. A note that mentions icons, borders, focus or large text is checked at 3:1. To keep a failing source value exact, say so in the note ("fails 4.5:1 on `card`; use only for large text"), and the check stops flagging it.

Take notes from the source's own comment first (the script copies it), then from where the token is used: `--report` lists the top files per token. The `unused` list marks tokens nothing references. Keep them, and say so in the note.

### Type styles

The script gives raw sizes only. Build named styles from how the UI really sets text:

1. Find the roles in the components: page title (the page header component), section title, card title, body, small body, label, caption, overline, the big number. The scan's `textSize` and `fontWeight` counts show which steps matter.
2. For each role, copy the exact `fontSize`, `lineHeight`, `fontWeight` and `letterSpacing`. Tailwind steps come from `theme.css` (`--text-sm: 0.875rem; --text-sm--line-height: calc(1.25 / 0.875)`).
3. Name them by role (`page-title`, `body-sm`), group them (`Headings`, `Body`, `Controls`, `Figures`), and give each a `sample` taken from the product's real copy and a `usage` note.

Families: a `next/font` family has no file in the repo, so write its stack (`"Assistant", system-ui, sans-serif`) under `type.families` and leave `type.fonts` empty. A hosted Google font works the same way. Copy local font files into `fonts/` (1 MB each at most) and list each one in `type.fonts` with its family, weight and style.

### Spacing, radius, shadow, size

- **Spacing.** List the steps the UI uses (the scan's `spacing` counts). For Tailwind, step n = n × `--spacing`: `gap-2` is `0.5rem` with the default `0.25rem` base. Name each step as the code says it (`space-2`), with its exact value. Lengths must be px, rem, em, % or a number. `svh`, `vw`, `min()` and `env()` values drop: describe those in the README's layout section instead.
- **Radius and shadow.** Take the project's overrides from the script, and add the default steps the UI uses (from `theme.css`) with their exact values.
- **Size and other families.** Control heights, sidebar width or z-index scales can go in extra families (`size`, `zIndex`), up to 12, each a `{tokens: […]}` list of plain values. There is no motion family: describe motion in the README.

### meta

```json
"meta": {"source": "github", "repo": "owner/name", "ref": "main@1a2b3c4", "package": "apps/web",
  "paths": {"tokens": ["app/globals.css"], "fonts": [], "assets": ["public/logo.svg"], "docs": ["AGENTS.md"]},
  "components": {"Button": "components/ui/button.tsx"}, "synced": "<YYYY-MM-DD>"}
```

Use `"source": "local"` when the repository has no GitHub remote.

## README

The README is the brand book a later agent reads first. Write it as imperative usage rules that name tokens, styles and components. It has no `#` title (the page shows the name), no build notes and no next steps. Its length tracks the source: a real codebase earns all of these sections.

1. **Opening paragraph:** what the product is, who it is for, and the one principle every screen follows. Source: the README and the landing page's hero copy.
2. **Content fundamentals:** voice, how the product addresses the user, casing rules (Title Case vs sentence case, and where each applies), the product's own terms and the words it avoids, number, date and currency formats, emoji or none, empty states, errors and help text. Quote real strings from the i18n files and name the rules `AGENTS.md` or lint rules enforce.
3. **Visual foundations**, one bolded paragraph and a few bullets per topic:
   - Colour: the ground, surface and ink hierarchy, the accent's single job, and status colours (always paired with a word).
   - Dark theme: what changes and what never does.
   - Type: the family and when each style is used.
   - Spacing and layout: the page frame, grid, gutters and control heights.
   - Radii, then elevation (when a border is used and when a shadow is).
   - States: hover, focus ring, selected and disabled.
   - Imagery and motion: real durations and easing from the code, and reduced-motion behaviour.
4. **Domain rules** the UI encodes, such as roles, data states or plan tiers.
5. **Accessibility:** the target level, contrast, names, keyboard, target sizes, and direction for RTL or bidi products.
6. **Iconography:** the library and its version, stroke and sizes, where SVGs live, and the mark's rules (size, ground, never recolour).
7. **Using the components:** page anatomy mapped to component classes, plus the few "don'ts" that matter most.
8. **Not synced:** one short closing note listing the variables skipped, fonts not fetched and components left out, with their paths.

## Components

### Choosing

Offer two routes in one question, with the static route first and recommended.

- **Static (default):** hand-made previews on one stylesheet. This route builds nothing from the repo.
- **Live:** the repo's real components bundled into `components/bundle.js`. It needs the user's go-ahead to install and build code they vouch for. The steps are in the type's `from-code.md` step 7.

Default selection: everything in the primitives folder (`components/ui`, `packages/ui`) plus app components imported by 10 or more files (`scan.mjs` ranks them). Skip contexts, providers, hooks, invisible wrappers and one-off route pieces. Group cards the way the code groups them, or use Actions, Forms, Navigation, Layout, Data display, Feedback and Overlays. Never add a component the code doesn't have.

### The prefixed stylesheet (static route)

Write one `components/bundle.css` with a short prefix from the product's name (`ac-` for Acme): a class per component and a modifier per variant (`ac-btn ac-btn--primary`). Distil each class from the component's real styles, read from its cva variants, `className` strings or CSS module:

| Tailwind in the component | In `bundle.css` |
| --- | --- |
| `bg-primary text-primary-foreground` | `background: var(--primary); color: var(--primary-foreground);` |
| `h-9 px-4` | `height: 2.25rem; padding-inline: 1rem;` (exact steps; `var(--space-4)` when that token exists) |
| `rounded-md` | `border-radius: var(--radius-md);` |
| `text-sm font-medium` | `font-size: 0.875rem; line-height: 1.25rem; font-weight: 500;`, or the type style's class |
| `hover:bg-primary/90` | `.ac-btn--primary:hover { background: color-mix(in oklab, var(--primary) 90%, transparent); }` |
| `focus-visible:ring-2 ring-ring` | `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }` |
| `disabled:opacity-50` | `:disabled { opacity: .5; cursor: not-allowed; }` |

Every colour, radius and shadow is a `var(--token)`, which is what makes the dark theme work with no extra CSS. Use logical properties (`padding-inline`, `inset-inline-end`, `margin-inline-start`). For an RTL product, put `dir="rtl"` on each preview's root.

### preview.html

```html
<!-- @dsCard group="Actions" height=76 -->
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Button</title></head>
<body>
<div class="ac-row">
  <button class="ac-btn ac-btn--primary">Save Changes</button>
  <button class="ac-btn ac-btn--primary" disabled>Save Changes</button>
  <button class="ac-btn ac-btn--outline">Cancel</button>
</div>
</body>
</html>
```

The page preloads `tokens.css`, the fonts and `bundle.css`, and sets `data-theme` on `<html>`. Show one component in its real states (variants, disabled, selected, error), with real copy from the product. Don't use the Tailwind CDN (it can't see the project's config), iframes, or URLs outside the artifact CDNs and Google Fonts. Set `height` to the rendered height.

### Component README

```md
# Button

Buttons trigger one action each: a filled primary for the view's main action, outline for the rest.

- **Primary** (`ac-btn ac-btn--primary`, 36px, `radius-md`): the view's main action, verb first. One per view. Fill `primary`, label `primary-foreground`.
- **Outline** (`ac-btn--outline`): secondary actions. Border `border`, hover fill `accent`.
- **Disabled**: keep it visible; use the real `disabled` attribute.

Consumer provides the label (no trailing punctuation) and the click handler. Source: `components/ui/button.tsx`.
Don't put two primary buttons side by side.
```

The first sentence is the summary the page shows.

## Publishing

1. **Create** (new system only): call `Artifact` `publish` with the `type_url`, a `title` (the system's name) and `auto_open: "after_first_write"`, with no files. Use the returned `url` from then on, and never pass `type_url` again.
2. **Upload assets:** call `Artifact` `publish` with that `url`, `asset: true` and `file_paths` set to the binary files under `<ds>/project/assets/` (25 at most per call). Each result gives `/_blob/<id>`.
3. **Index**, written last as `<ds>/project/design-system.json`. Follow the type's `SKILL.md` for the exact shape:

```json
{"v": 3, "layout": "files", "createdOnFiles": {"v": 1, "at": "<now, ISO-8601>"},
 "title": "Acme", "namespace": "Acme", "libraries": [], "sections": {},
 "groups": ["Logos"],
 "assetGroups": {"Logos": {"name": "Logos", "tile": "l", "order": ["acme-mark.svg"],
   "files": {"acme-mark.svg": {"name": "acme-mark.svg", "blob": "<id>", "size": 1942, "type": "image/svg+xml"}}}},
 "blobs": {}, "docs": {"readme": "project/README.md", "sections": []},
 "lastChange": {"by": "<the user's name>", "at": "<now>", "via": "Claude Code · owner/name@1a2b3c4", "note": "Extracted from code."}}
```

4. **Send:** `node check.mjs <ds> --map` prints `calls`. Send each as `Artifact` `publish` with `url`, `root`, `file_path` and `files`, in order. The index rides in the last call. One call carries 255 paths at most, which the map already respects.

Don't write `tokens.css`, `manifest.json` or `api/`: the page generates them.

## Re-sync

Use this when the system exists, or when `tokens.json` `meta` names a source.

1. `read` the live index and every file you will change, into `<ds>`. People edit the page, so never work from an older copy.
2. Tell the user what `meta` recorded last time (repo, ref, package) and whether it differs from what they named now. Their answer wins.
3. Re-run the scan and the token script on the current code, then merge. Update changed values, add new tokens and components, and keep usage notes, README prose, assets and anything added on the page. List tokens the code no longer defines, and ask before removing them.
4. Rewrite `meta`. Set `lastChange.note` to a summary like "re-synced to 9f8e7d6: 3 colours changed, 1 added". Read the index again right before sending, and send only the changed files with the index last.

If the index has `"editing": "code"`, the system is owned by `/design-sync`. Say so and stop.

## Gotchas

- **Dropped values:** named colours (except white, black and transparent, which the script converts), `var()` left in a value, `color-mix()`, `light-dark()`, `currentColor`, and relative colour syntax. The script lists them under SKIPPED. Write a per-theme literal by hand only when it is the exact same colour.
- **Theme detection:** `.dark .card { --x: … }` is a component scope, not a theme, so it is skipped. A theme toggled by a JS class on `<body>` or by a `data-` attribute other than theme, mode, color-scheme or color-mode isn't detected; add that theme by hand.
- **Fonts set at runtime:** with `next/font`, `--font-sans: var(--font-geist-sans)` can't be resolved from CSS, so the script lists it under SKIPPED and the scan's FONTS section names the family.
- **Translucent grounds:** contrast composites them over white in light themes and black in themes whose id contains "dark".
- **Icons from a package** (Lucide, Heroicons): no SVG files are copied. Name the library, version, stroke and sizes under Iconography. Copy only SVG files the repo itself holds, and for a big set choose the icons the UI imports most and say so.
- **Big systems:** more than 254 files take several publish calls. `--map` splits them, and the index always goes last.
