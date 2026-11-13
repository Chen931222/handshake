---
name: Handshake
description: Text by sound, no network. A talking board whose lens shows the measured signal.
colors:
  ground: "#16110c"
  ground-raised: "#1e1711"
  ground-sunk: "#110d09"
  line: "rgb(239 228 207 / 0.14)"
  line-strong: "rgb(239 228 207 / 0.28)"
  ink: "#efe4cf"
  ink-2: "#bcae95"
  ink-3: "#8f8370"
  brass: "#c9973a"
  brass-soft: "rgb(201 151 58 / 0.22)"
  no: "#d9705a"
typography:
  display:
    fontFamily: "\"IM Fell English\", \"Iowan Old Style\", \"Noto Serif TC\", \"PMingLiU\", Georgia, serif"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.01em"
  board-word:
    fontFamily: "\"IM Fell English\", \"Iowan Old Style\", \"Noto Serif TC\", \"PMingLiU\", Georgia, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1
  spirit:
    fontFamily: "\"IM Fell English\", \"Iowan Old Style\", \"Noto Serif TC\", \"PMingLiU\", Georgia, serif"
    fontSize: "clamp(1.25rem, 1rem + 1.6vw, 1.75rem)"
    fontWeight: 400
    lineHeight: 1.3
  headline:
    fontFamily: "\"IM Fell English\", \"Iowan Old Style\", \"Noto Serif TC\", \"PMingLiU\", Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.2
  goodbye:
    fontFamily: "\"IM Fell English\", \"Iowan Old Style\", \"Noto Serif TC\", \"PMingLiU\", Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.14em"
  body:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  input:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.45
  button:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1
  label:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  data-small:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    fontFeature: "\"tnum\" 1"
rounded:
  inner: "2px"
  base: "4px"
  lens: "50%"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "40px"
  "7": "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.button}"
    rounded: "{rounded.base}"
    padding: "0 24px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "#fbf3e2"
    textColor: "{colors.ground}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.base}"
    padding: "0 24px"
    height: "44px"
  button-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
  text-input:
    backgroundColor: "{colors.ground-sunk}"
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.base}"
    padding: "12px 16px"
  field-input:
    backgroundColor: "{colors.ground-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
    height: "44px"
  segmented-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.inner}"
    padding: "8px 14px"
    height: "40px"
  segmented-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
  timeline:
    backgroundColor: "{colors.ground-sunk}"
    rounded: "{rounded.base}"
    height: "28px"
  timeline-fill:
    backgroundColor: "{colors.brass-soft}"
---

# Design System: Handshake

## Overview

**Creative North Star: "The Talking Board"**

Handshake is a séance board laid on a walnut table at night: a near-black warm ground, bone ink, and one aged-brass mark that only ever means "the signal, now". The board's words (YES, NO, GOOD BYE), the received message and the page titles are cut in an engraved serif; everything the user operates or measures is set in the system sans with tabular figures. The theme carries information, never decoration: the lens rim is the clarity meter, the timeline is the frame drawn to its real duration, and failure is a struck-through broken message with its real reason.

The page is a single 780px column, dense in the controls and generous around the board. Surfaces are flat; depth comes from three nearly identical walnut tones and hairlines of bone at 14% and 28%. Nothing glows, nothing blurs, nothing is textured. Degradation is printed, not filtered: noise breaks the rim's ink into dashes and knocks the inner ring out of register, like a misaligned press.

Visual rejections confirmed by the build and the finish review: no wood texture, no glow halos, no blur on the signal, no green/red result card.

**Key Characteristics:**
- Walnut ground, bone ink, one brass accent for the live signal.
- Engraved serif for the board's voice; system sans for controls and data; tabular numerals for every measurement.
- Signal quality expressed as print register (dashed ink, offset inner ring), never as blur or glow.
- Failure lights NO and GOOD BYE in bone, not red.
- Flat surfaces, hairline borders, 4px corners.

## Colors

A warm, near-monochrome night palette: three walnut grounds, three bone inks, one brass signal, one reserved warning red.

### Primary
- **Aged Brass** (`brass`): the live signal and only the live signal: the lens rim stroke, the active segmented-tab underline (2px inset), the timeline's on-air edge, the range slider (via `accent-color`), the clarity percentage, and YES when a frame decodes. It also marks the user's own point of action: the focus ring (2px, 3px offset), the text caret, text selection, and link underlines.
- **Brass Wash** (`brass-soft`): the timeline fill behind the advancing brass edge. Never a surface fill anywhere else.

### Neutral
- **Walnut Black** (`ground`): page ground and theme colour.
- **Raised Walnut** (`ground-raised`): used only as the peak of the lens veil's breathing animation while listening and idle.
- **Sunk Walnut** (`ground-sunk`): inside of things: text inputs, the lens veil, the timeline track.
- **Bone** (`ink`): primary text, the received message, the lit NO and GOOD BYE, and the primary button's fill.
- **Worn Bone** (`ink-2`): labels, hints, idle message text, inactive tabs, table headers.
- **Faded Bone** (`ink-3`): placeholders, unlit board words, readout terms, scale captions, disabled text, struck-through corrupt bytes. Holds 5:1 on the ground; unlit board words sit at 0.8 opacity and remain words, not texture.
- **Hairline** (`line`) and **Strong Hairline** (`line-strong`): every border and divider. Strong for control outlines and the timeline; plain for section rules and table rows.

### Warning
- **Signal Red** (`no`): form validation only (invalid field border, error text, byte count over the limit) and the mic-constraint "still on" warning.

### Named Rules
**The One Brass Rule.** Brass means the live signal or the user's current focus point. It is never a surface, a heading colour, a decorative rule, or a second brand colour.

**The Bone Failure Rule.** A failed decode lights NO and GOOD BYE in bone. Red is not the failure colour on the board; it is reserved for a form the user must correct and for a microphone the browser refused to configure.

## Typography

**Display Font:** IM Fell English 400, self-hosted from @fontsource (Latin subset only), falling back to Iowan Old Style, then Noto Serif TC / PMingLiU for Chinese, then Georgia.
**Body Font:** system-ui sans (Segoe UI, Noto Sans TC, Microsoft JhengHei).

**Character:** An engraved, slightly uneven 17th-century serif speaks for the board; a plain system sans does the work. The serif never appears on a control or a number.

### Hierarchy
- **Display** (400, 2.5rem, line-height 1, 0.01em; 2rem under 560px): the page title in the masthead.
- **Board word** (400, 2rem, line-height 1; 1.5rem under 560px): YES and NO on the arc.
- **Spirit** (400, clamp 1.25rem to 1.75rem, line-height 1.3, balanced wrap): the received message inside the lens. Spelled letter by letter with a transparent ghost reserving the final layout; instant under reduced motion.
- **Headline** (400, 1.5rem, line-height 1.2): visible section titles ("On the air", "Runs").
- **GOOD BYE** (400, 1.5rem, uppercase, 0.14em): the board's failure word. Uppercase tracking is the talking board's own lettering and is used for this word only.
- **Body** (400, 1rem, line-height 1.5): running text; hints cap at 62ch and 0.9375rem.
- **Input** (400, 1.125rem, line-height 1.45): the message textarea and number field.
- **Button** (500, 1rem, line-height 1; primary at 600).
- **Label** (400, 0.875rem, Worn Bone): field labels and the air-time key.
- **Data small** (400, 0.8125rem): readout terms, scale captions, the corrupt-message label (500), error text.

### Named Rules
**The Two Voices Rule.** The serif is the board talking (title, board words, received message, section titles). The sans is the instrument (controls, labels, data). Do not cross them.

**The Tabular Rule.** Every measurement (bytes, seconds, dB, ppm, clarity, table numbers) uses tabular numerals; numeric table columns align right.

## Layout

One centred column, max 780px, padded 24px top, 16px sides, 40px bottom. The masthead puts the title left and the segmented controls right, wrapping on a 16px/24px gap, closed by a hairline. Main is a grid with 40px between sections. On the Send tab the air-time section is ordered before the board so the frame just sent sits under the composer.

Spacing is a fixed seven-step scale (4, 8, 12, 16, 24, 40, 64px); panel internals use 12px, control groups 8 to 12px, section separation 40px. The board is ruled top and bottom by hairlines with 40px above the lens. The lens is square, `min(420px, 100%)`.

Single breakpoint at 560px: segmented controls go full width with equal segments, action buttons stretch to share the row, the listener controls stack, the readout drops to two columns with the detail full width, and the air-time key goes to two columns. Field log form fields auto-fill at 200px minimum; the table scrolls horizontally inside a bordered wrapper.

## Elevation & Depth

Flat. There are no drop shadows. Depth is tonal: Sunk Walnut for anything you look into (inputs, the lens, the timeline track), Walnut Black for the page, Raised Walnut only as the breathing peak of an idle listening lens. The only `box-shadow` uses are 2px and 1px insets that draw lines without taking space: the active tab underline in brass and the hairline ticks between timeline segments.

### Named Rules
**The Print Register Rule.** Signal quality is shown the way a press shows it: at low clarity the rim ink breaks into dashes, fades to 35% opacity, and the inner ring slips up to 4px out of register. No blur, no glow, no text-shadow, and the decoded text and failure reason are never degraded.

## Shapes

Quiet rectangles with gently eased corners (4px) on every control, input, timeline and table wrapper; 2px on the inner segmented tab. The one round form is the lens: two concentric SVG circles (2.5 and 0.75 stroke) over a circular veil inset 9%. Borders are always 1px hairlines in bone at 14% or 28%.

## Components

### Buttons
Plain and certain: one bone-filled primary per view, everything else outlined.
- **Shape:** gently eased corners (4px), 44px minimum height, 24px side padding.
- **Primary:** Bone fill, Walnut Black text, weight 600, 140px minimum width. Used for Send, Start/Stop listening, Add row.
- **Hover / Focus:** primary brightens to a paler bone (#fbf3e2); quiet buttons raise their border to Worn Bone. 160ms ease-out. Focus is the global 2px brass ring.
- **Quiet:** transparent with a strong hairline border, Bone text (Open listener, Download CSV).
- **Disabled:** transparent, Faded Bone text, plain hairline border.
- **Link button:** text-only, Worn Bone, underlined in a strong hairline, 32px tall (row delete in the field log).

### Segmented control
- **Style:** strong-hairline outline with 2px padding; segments 40px tall, Worn Bone text.
- **State:** hover lifts text to Bone; checked is Bone text with a 2px brass inset underline and no fill. Native radios sit invisibly over each segment.

### Inputs / Fields
- **Style:** Sunk Walnut fill, strong hairline border, 4px corners, brass caret. Textarea 12px/16px padding at 1.125rem; field-log inputs 44px tall at 1rem.
- **Hover:** border rises to Faded Bone.
- **Focus:** the global brass focus ring.
- **Error:** border and the message below turn Signal Red (`aria-invalid="true"`).

### The Lens (signature)
The planchette's window and the system's meter. A square holding the brass two-ring rim, the sunk veil and the centred message text at 72% width. Clarity (0 to 1) drives the rim opacity (0.35 to 1), the dash pattern (solid at 1, dotted at 0), and the inner ring's offset, all at 400ms ease-out. While listening and idle the veil breathes between Sunk and Raised Walnut over 3.2s. On a checksum failure the lens shows a small sans label ("Not the message. This is what arrived:") above the arrived bytes in Faded Bone, struck through in Worn Bone.

### The Board arc
YES top-left and NO top-right in the board-word serif, unlit in Faded Bone at 0.8 opacity. A decode lights YES in brass; a failure lights NO and GOOD BYE in Bone. 600ms ease-out.

### Readout
A definition list under the lens: Clarity (brass, tabular), Bytes, Detail. Terms in Faded Bone at 0.8125rem.

### Air-time timeline
The frame drawn to scale: a 28px Sunk Walnut track, one flex segment per frame part sized by its byte count, separated by inset hairline ticks; the message segment carries a 5% bone wash. A drawn bar carries no text; the empty track shows one Faded Bone prompt ("Send a message to see its frame."). A brass-wash fill with a 2px brass leading edge scales across it in real time while playing. Below it, a key lists each part with its seconds (tabular, right-aligned) on hairline-ruled rows; the total seconds sit right-aligned in the section head at 1.25rem.

### Mic constraints
A two-column definition list reporting each audio filter the browser honoured ("off, as asked") or kept ("still on", Signal Red).

## Do's and Don'ts

### Do:
- **Do** keep brass to the live signal (rim, active tab underline, timeline fill, slider, clarity number, lit YES) and the focus/caret/selection affordances.
- **Do** show degraded signal as broken ink and mis-registration on the rim: dashes, lower opacity, offset inner ring.
- **Do** light NO and GOOD BYE in Bone on failure and print the real reason in Bone below the message.
- **Do** show corrupt bytes struck through under a "Not the message" label, never as if they were the message.
- **Do** draw durations to scale and put numbers in a key or head, in tabular figures, right-aligned.
- **Do** keep the decoded text and failure reason at full contrast in every signal state.
- **Do** honour reduced motion: no spelling animation, no breathing, no transitions.

### Don't:
- **Don't** blur, glow, or text-shadow anything to express signal quality.
- **Don't** use Signal Red for decode failure; it is for form validation and the mic-constraint warning only.
- **Don't** add wood grain or any texture to the walnut ground.
- **Don't** set controls, labels or numbers in IM Fell English, or the board's words in the sans.
- **Don't** label the drawn timeline segments; once a frame is drawn the bar carries no text (the empty track's one-line prompt is the only text it ever holds).
- **Don't** add drop shadows; depth is tonal.
