# Pivot — Design Guide v1.0

> Editorial outside, legible inside. Cream paper, sage ink, one field of green.

## Core principles

1. **Warm light, not harsh contrast.** Cream backgrounds, sage-charcoal ink (never pure black). Every surface should feel like golden hour, not fluorescent light.
2. **One field of green.** Sage green is the only accent — brand mark, primary actions, active states, "healthy" data. No blue, purple, or new chromatic accents.
3. **IBM Plex Sans in the app, serif on the street.** IBM Plex Sans — engineered by IBM for technical and data display — is the in-app typeface. Tall x-height, distinct letterforms, dotted (not slashed) zeros, and tabular numerals built in. Instrument Serif is reserved for the brand wordmark and marketing surfaces.
4. **Data earns its place.** Numbers in cards/stats are IBM Plex Sans Bold with tabular figures. Mono is for true labels only: units, statuses, eyebrows. Never set running numbers in mono.

## Color tokens

```css
/* core */
--cream:      #fbf7ec;   /* page / paper */
--cream-2:    #f3ecda;   /* receding wash */
--paper:      #ffffff;   /* cards / surfaces */
--ink:        #4a5a4a;   /* text / headings (never pure black) */
--ink-soft:   rgba(74,90,74,0.62);
--ink-line:   rgba(74,90,74,0.10);   /* hairlines */
--green:      #5e9544;   /* primary / brand */
--green-dk:   #3a6a3f;   /* hover / emphasis */
--green-soft: #e6efd8;   /* tinted fill */

/* status accents — use sparingly */
--ochre:      #c39a40;   /* caution / dry-ish */
--clay:       #9a7a3c;   /* eyebrows / section tags */
--rust:       #c46a4a;   /* alert / too dry */
```

## Type

```css
--serif: "Instrument Serif", serif;          /* MARKETING ONLY */
--sans:  "IBM Plex Sans", system-ui, sans-serif;  /* IN-APP */
--mono:  "IBM Plex Mono", monospace;        /* labels only */
```

| Role | Font | Size / Leading / Tracking | Scope |
|---|---|---|---|
| Marketing display | Instrument Serif 400 | 60 / 0.98 / -0.02em | Marketing only |
| Screen title (H1) | IBM Plex Sans 700 | 36 / 1.05 / -0.015em | In-app |
| Card title (H2) | IBM Plex Sans 700 | 22 / 1.15 / -0.005em | In-app |
| Lede / subhead | IBM Plex Sans 400 | 19 / 1.5 | In-app |
| Body | IBM Plex Sans 400 | 15 / 1.6 | In-app |
| Data / stats | IBM Plex Sans 700 tabular | 14–26 / `tnum` | In-app |
| Eyebrow / label | IBM Plex Mono 500 | 11 · 0.16em · UPPER | In-app |

**Why IBM Plex Sans:** IBM's corporate typeface, designed to hold up at small sizes on technical interfaces. Numerals line up vertically (tabular figures by default), the zero is dotted instead of slashed (reads as a number, not a typographic curiosity), and `I` / `l` / `1` stay unambiguous at any size. Calm, sturdy, and built for working phones in real sunlight.

## Space & form

- **Spacing scale (4px base):** xs 4 · sm 8 · md 14 · lg 24 · xl 40 · 2xl 64 · 3xl 96.
- **Radius:** one card radius `10px`, full pills `999px` for buttons/chips/tabs. Nothing in between.
- **Hairlines:** `rgba(74,90,74,0.10)` — almost invisible. If a card needs presence, lift the background to paper white. Don't darken the border.

## Components

- **Buttons.** One primary per surface, always field green. Secondary is hairline border on page bg, no fill. Ghost is transparent with soft ink.
- **Pill tabs.** Active tab fills with green. Inactive transparent on a soft track.
- **Status chips.** Mono caps, tinted background, matching border. Never solid-fill — they're markers, not buttons.
- **Stat strip.** Numbers in IBM Plex Sans Bold tabular; labels in mono. Horizontal rules above and below — never wrap in boxes.
- **Cards.** Hairline border at rest. Active state gets a soft green border, not a heavy ink outline.

## Do

- Use IBM Plex Sans for every in-app screen, card, button, stat.
- Use field green for **one** primary action per surface.
- Label small things (units, statuses, timestamps, eyebrows) in IBM Plex Mono caps at 11px+.
- Set running numbers in IBM Plex Sans Bold with tabular figures.
- Let cream paper do the spacing work. White space is part of the design.
- Show data visually (dials, circles, sweeps) before showing it numerically.

## Don't

- Use Instrument Serif inside the app — marketing & wordmark only.
- Use pure black anywhere. Ink is sage-charcoal `#4a5a4a`.
- Introduce blue, purple, or any new chromatic accent.
- Set mono text smaller than 11px, or with more than 0.16em tracking in-app.
- Stack heavy outlines or shadows — surfaces should feel printed.
- Use emoji or decorative icons. If you need an icon, draw a glyph.
