---
name: office-designer
description: Design a themed office for AgentCorp as one JSON manifest that follows the office contract, so the app can draw it.
---

# Office designer

You turn a short brief into one file, `office.json`: a manifest that restyles
one of the built-in rooms and dresses it with decorations and agent looks
built from boxes, cylinders, spheres and cones. Nothing in it runs. The app
draws exactly what the file says, and refuses anything outside the contract,
so the job is as much about staying inside the lines as about taste.

## What a good office is

- **One idea, carried through.** The brief names a theme. Every choice (the
  palette, the floor, the light, the props, the clothes) should say that theme.
  A pirate ship has planks, lanterns, rope and rum barrels, not a random mix.
- **Readable.** People play in this room for hours. Sixteen workers sit at the
  desks and show four states by colour and motion (working, waiting on you,
  idle, in trouble), and a glowing screen says a desk is busy. Keep walls and
  floor calm and mid-to-dark, and keep the screen colours bright and distinct
  from everything around them, so the states read at a glance.
- **A cohesive palette.** Pick five to seven colours and reuse them. Wood and
  metal and fabric can each be a slightly different value of the same hue.
  Set `palette` keys so the built-in fixtures (shelves, door, rack, trophy
  cabinet) join the theme instead of fighting it.
- **Contrast where it matters.** Decorations should stand out from the wall or
  floor behind them. Light things on dark, dark things on light. Avoid putting a
  prop the same colour as its slot's background.
- **Use the slots.** Fill most of the floor and wall slots with something that
  belongs; an empty room reads as unfinished. The wall bands high up are for
  long things (bunting, garlands, pipes, a frieze). The `desk` slot repeats on
  every desk, so keep it small, quiet and on-theme (a mug, a candle, a plant).
- **Keep the front low.** The `front-centre` slot is closest to the camera.
  Anything tall there hides the room. Use low or flat props there.
- **Three to six distinct looks.** Each worker wears one of the looks. Make
  them tell apart at a distance: different shirt colours, different hats or
  add-ons, different hair. Keep skin tones varied and realistic unless the
  theme says otherwise (robots, ghosts). Add-ons are small and attach to a
  limb: a hat on `head`, a tool in `armR`, a satchel on `body`.
- **Effects sparingly.** `glow` on a few lanterns or screens, `flicker` on a
  candle, `float` on a balloon. Never on everything: motion everywhere is
  noise, and glow everywhere washes out the agent states.
- **Particles are a mood, not weather.** Low `density` (0.1 to 0.4) is almost
  always right. Match the kind to the theme: embers for a forge, dust for an
  attic, sparkles for a party, none for a clean office.
- **Lighting sets the time of day.** Warm sun from one side for an afternoon,
  cool dim ambient with bright glowing props for night. Keep
  `ambientIntensity` above 0.4 unless the glowing props carry the room.

## Building props from parts

- Sizes are in metres; a desk top is about 0.75 high and a person about 1.5.
- A part's `at` is its centre, relative to the slot's origin. Floor and desk
  slots: y goes up from 0 at the floor or desk top, so a box 0.5 tall that
  stands on the floor sits at y 0.25. Wall slots: z goes out from the wall,
  so a 0.1 deep picture sits at z 0.05.
- Everything must fit inside the slot's `max` box (width, height, depth),
  rotation included. Leave a little margin rather than touching the limit.
- Build recognisable things from few parts: a barrel is a cylinder and two
  thinner dark cylinders for hoops; a lantern is a small box, a glowing
  sphere and a cone cap; a palm is a cylinder trunk and a few flat rotated
  boxes for fronds. Ten to twenty parts make most props; spend parts where
  the camera sees them.
- Give every decoration a plain `name` that says what it is.

## Writing the file

- Write valid JSON only, every key the contract names and none it does not.
  Colours are `#rrggbb`. Numbers are numbers, not strings.
- No markup, links, code or template syntax in any text field, and nothing
  with `<`, `>`, backticks, `{{` or `${` in it.
- `name` and `description` are what the picker shows: a short name and one
  sentence someone would want to click.
- `tags` are lower-case words with dashes for the showcase search.

## Before you finish

Re-check the limits yourself, because the app will: at most 40 decorations,
48 parts each, 900 parts in all, 3 to 6 looks, 24 add-on parts per look, at
most one `desk` decoration, every part inside its slot, every colour a hex,
every enum one of the listed values, and the whole file under 256 KB. Then
read the brief once more and ask whether the room says the theme at a glance.
