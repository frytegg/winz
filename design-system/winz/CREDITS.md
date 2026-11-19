# Credits

## Welcome screen photo (`apps/web/public/onboarding/hero.jpg`)

- Source: Pexels, photo 159515, "Football Player Holding Football".
  https://www.pexels.com/photo/159515/
- Author: Pixabay (https://www.pexels.com/@pixabay), taken 25 Aug 2005.
- Licence: the Pexels licence (free for personal and commercial use, no attribution required).
  https://www.pexels.com/license/
- What we changed: converted to black and white and slightly contrasted (1200 × 1800 JPEG), and the
  school decal on the helmet (a swoosh around an "H") painted out: the area is refilled from the
  silver around it with a little grain, so the helmet reads as plain. It sits under a gradient to
  black, as in the mockup.
- Why it replaced the mockup's photo: that one shows a player in a recognisable league jersey and
  has no known licence.
- Still visible, small: the ball's maker mark, a shoe and wristband logo, and a "Gulf Coast" tag
  on the jersey hem. None is legible at phone size, none identifies a team. If one is wanted gone,
  repeat the same fill on it.

## Sora, for the generated images (`apps/web/lib/og/fonts/`)

- Source: the Sora project, https://github.com/sora-xor/sora-font (`fonts/ttf/Sora-Regular.ttf`,
  `Sora-SemiBold.ttf`, version 2.000), unchanged.
- Licence: SIL Open Font License 1.1 (free to use and embed, no attribution required, the font itself
  cannot be sold on its own).
- Why a copy in the repo: the app's screens get Sora from `next/font/google`, but the image renderer
  behind the share preview and the poster needs the raw files, and it reads TTF, OTF or WOFF only.
