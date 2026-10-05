# Design

Direction set 2026-10-05 from the founder's "Glassy Dashboard" reference video: minimalist dark glass, clean element lift on hover/press, curved icon dock on the left. Supersedes the Creator_OS orange/brown gradient + pearl chart treatment.

## Theme

Dark only. Near-black canvas with blurred warm light streaks (the only decoration), one large glass app window floating on it. Glass is structural (window, top bar, panels), not sprinkled.

## Color

Restrained, from the founder palette:

| Role | Value |
|---|---|
| Canvas | `#0d0b0c` + warm streaks of `#ff6d29` |
| Ink (text on orange) | `#161316` |
| Accent / dock / selection | `#ff6d29` |
| Text | `#ffffff`, secondary `#bababa`-ish at ≥4.5:1 |
| Glass fill | white 3–7% over blur, 1px white 8–10% rim, 6% top inner highlight |

Orange is reserved for the dock, primary actions, selected state and chart data.

## Typography

Geist only. Fixed rem scale ~1.2: 12 / 13 / 14 / 16 / 18 / 22 / 28. Numbers use tabular figures.

## Components

- **Dock**: 68px orange column with elliptical right corners (narrow at top and bottom, full width in the middle). Icon-only; active item is a white rounded square with ink icon; tooltip label on hover/focus. Unbuilt modules show as dimmed "Soon".
- **Top bar**: glass strip with wordmark, pill route tabs, search (⌘K / Ctrl K), primary action.
- **Cards**: glass, 18px radius. Interactive cards lift 3px with a deeper shadow and brighter rim on hover; press settles to 1px. Selected = orange rim + faint orange wash.
- **Pills**: segmented groups for platform and route tabs; active pill is a lighter glass chip.

## Motion

200–260ms, `cubic-bezier(.22,1,.36,1)`. Transform, shadow and border only. Reduced motion: no transforms. Reduced transparency: solid surfaces.
