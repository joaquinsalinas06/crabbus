# Attribution

## Pixel crabs and costumes (src/art.ts)

The crab and the six costume ideas (astronaut, detective, engineer, chef, racer, pirate), the clay
body color and the tier colors come from the drawing in **savvy-progress**
(`plugins/savvy-progress/hooks/register.tsx`, lines "Pixel Clawd from DockCrab (Clawdy)") from
<https://github.com/JohnnyVizz/claude-kit>, MIT licensed (the repository page states "MIT license";
plugin manifest `license: MIT`, author johnnyvizz). That file in turn credits **DockCrab / Clawdy**
as the origin of the crab and of the chef's toque (`Sprites.chefHat`). The original source was only
read, never copied from or modified in its install location.

In v0.2 every sprite was redrawn by hand at 18x14 pixels for the terminal (the shapes are new; the
costume ideas, palette and tier colors follow savvy-progress). CrabBus's own additions: the per-frame
animation, the propeller beanie, the crowned master, the activity props and effects (book, pencil, flask,
thought dots, alarm, sparks, zzz), envelopes and the half-block encoding.

MIT notice, for the reused drawing data:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions: The above copyright notice and this
> permission notice shall be included in all copies or substantial portions of the Software. THE
> SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
>
> Copyright (c) johnnyvizz (claude-kit / savvy-progress). The upstream LICENSE file text was not
> retrieved verbatim: confirm the exact copyright line there before publishing this plugin.

## Patterns studied, no code copied

- crab-buddy (ziedgithub, MIT): Raster band + `$.ui.blit` + `$.agent.list` crew pattern.
- image-peek (arasovic): `Image` element and iTerm2 flag behaviour.
- clawd (yushiran, license NOASSERTION): not used, ideas only.
