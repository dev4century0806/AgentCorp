# People, desks and slots: sizes and where everything is

Read this before you design `looks` or place anything. All sizes are metres.
The room is built of boxes, so a person is a figure of blocks, about 1.5 m
tall (not 1.8). Add-ons and decorations are measured against these numbers.

## The room

- The floor is 20 by 20: x from -10 (left wall) to 10 (right wall), z from -8
  (back wall) to 12 (front wall). The walls are 5 high. y is up from the floor.
- The camera starts in the front-right corner, looking at the back-left, so the
  front and right walls are the near ones. When the view turns, whichever two
  walls are nearest the camera disappear, and wall decorations go with them.
- Sixteen desks sit in four pods of four, pairs facing each other across the
  middle of the pod. Workers sit in the chairs and walk the corridors between
  the pods (the gaps at the back wall, the middle, the front and three
  between-pod aisles). The renderer keeps every slot clear of all of that.

## A desk, to scale

- Desk top: 1.5 wide, 0.85 deep, its top surface at y 0.75 (0.76 in the garage).
- Screen: a monitor about 0.55 wide and 0.45 tall standing on the desk, its top
  edge about 0.5 above the desk top, with the lit panel 0.42 by 0.32. The
  keyboard is 0.48 wide, 0.16 deep, in front of it.
- Chair seat: 0.44 high, 0.5 wide. A sitter's head is at 1.28 (centre), so the
  top of their head is level with the top of the monitor plus about 0.3.
- Mug 0.12, candle 0.16, a houseplant 0.3: this is the scale of the `desk`
  slot, which is a 0.36 wide, 0.36 tall, 0.3 deep box beside the screen on the
  outer side of the desk.

## A person

A worker faces **+z** (the eyes are on the +z side of the head). Everything
below is in the person's own space when standing, with the origin on the
floor between the feet. Seated or walking, the limbs swing about the same
pivots.

- **Overall:** feet at y 0, top of the bare head at 1.49. Hair adds up to 0.1
  (crop), 0.2 (mohawk) or 0.25 (top bun) above that.
- **Head:** one block 0.44 wide (x) by 0.42 tall (y) by 0.42 deep (z). Its
  centre is at y 1.28. Face is the +z side, 0.21 from the centre; the eyes are
  two 0.07 squares at x ±0.1, y +0.02. The top of the head is +0.21 from the
  centre, the chin -0.21, the ears (sides) ±0.22.
- **Torso:** one block 0.56 wide by 0.56 tall by 0.32 deep, centre at y 0.78,
  so it runs from the hips at y 0.5 up to the shoulders at y 1.06. The head sits
  directly on it with no neck.
- **Arms:** each 0.16 wide by 0.18 deep and 0.46 long, plus a 0.12 tall hand.
  The shoulder pivot is at x ±0.36, y 1.02. An arm hangs straight down from
  there to y 0.48 (0.54 below the pivot). The arm at x -0.36 is `armL`, the
  one at x +0.36 is `armR`. They swing forward and up as the person types,
  waves for help or walks.
- **Legs:** each 0.2 wide by 0.22 deep and 0.5 long, plus a 0.08 tall shoe that
  sticks 0.19 forward. The hip pivot is at x ±0.13, y 0.5. A leg hangs straight
  down to the floor. `legL` is the one at x -0.13, `legR` at x +0.13. When
  sitting, the legs swing forward to horizontal.

## Anchors for add-ons

An add-on belongs to one anchor and moves with it. Its parts are positioned
relative to that anchor's origin, by their centres, with x right, y up and z
toward the way the person faces (+z is forward).

| anchor | origin | notes |
|---|---|---|
| `head` | the centre of the head block (y 1.28 in the standing figure) | Up is +y: the top of the head is y +0.21, hair reaches +0.31 to +0.47. A hat brim sits around y +0.24; its crown above that. The face is +z (0.21); things at z +0.22 sit on the face (glasses, a mask, a beard); at z -0.21 they are at the back of the head. Ears are x ±0.22. |
| `body` | the middle of the torso (y 0.78 in the standing figure) | The torso spans y -0.28 (belt) to +0.28 (shoulders), x ±0.28, z ±0.16. A scarf or collar at y +0.3. A backpack or cape at z -0.2 and behind. A belt or sash at y -0.2. A badge at x 0.15, y 0.15, z +0.17. The shoulders (for a parrot) are x ±0.3, y +0.3. |
| `armL` / `armR` | the shoulder joint | The arm hangs down -y: the sleeve runs y +0.03 to -0.43, the hand y -0.42 to -0.54. A bracelet is around y -0.38; a hook, a torch, a wand or a tool at the hand is at y -0.5, held in front with z +0.1. Things on the shoulder (an epaulette, a pauldron) are around y +0.05, x ±0.05 outward. |
| `legL` / `legR` | the hip joint | The leg hangs down -y to y -0.5 (the floor); the shoe is y -0.43 to -0.51 and reaches z +0.19. Boots and knee guards are around y -0.2 to -0.35; spurs and anklets at y -0.45. |

The contract limits what fits at each anchor: `head` 0.9 wide by 1.2 tall by
0.9 deep, `body` 0.9 by 1.0 by 0.8, each arm 0.5 by 1.3 by 0.5 and each leg
0.5 by 1.3 by 0.6, all centred on the origin. Measure those limits from the
origin above: an arm or leg part may reach y -0.65, so a hand at y -0.5 or a
shoe at y -0.47 fits. Only the colours `skin`, `hair`, `shirt` and
`pants` and the `hairStyle` and `outfit` of a look come from the look itself;
everything else (a hat, a beard, goggles, wings, a tail) is an add-on.

What the look's own fields do:

- `hairStyle`: `crop` is a short cap of hair with a fringe at the back, `bun` the
  same with a top bun, `mohawk` a ridge along the top, `shoulder` hair falling
  past the ears. `none` draws no hair at all, for helmets, hoods, hats that
  cover the head, or a bald head.
- `outfit`: `tee` and `hoodie` colour the whole torso and arms with `shirt` (a
  hoodie adds a darker hood and a pocket). `tie`, `labcoat` and `cardigan`
  keep the torso and arms white and use `shirt` for the tie, the coat's pocket
  and trim, or the cardigan's knit, so a coloured `shirt` there gives an accent
  and not a coloured body. For a uniform of one colour, use `tee` and put the
  colour in `shirt`.
- `pants`: the colour of both legs. The shoes are always dark.

Each worker wears one look, the same one every time, picked from their id. Pam, who sits at reception, always wears the first look, so make that the one a host would wear.

Keep the people readable at a distance: the state of each worker (typing, hand
raised for help, idle, reviewing) shows in the pose, so do not hide the arms or
raise add-ons above the head in a way that looks like a raised hand. Make the
five or six colours of each look distinct from the others and from the walls.

## The slots, one by one

Floor slots are measured from the middle of their footprint on the floor (y from
the floor), with +x to the right and +z toward the front wall, the camera's
side. A thing facing +z looks at the default camera. Wall slots are measured
from the middle of their area on the wall: x runs left to right as seen from
inside the room, y up from the middle, and z comes out of the wall into the
room. Every slot is clear of desks, walkways, the places workers stand and
the fixtures, in every base room.

| slot | where, in room coordinates | box you may fill (w x h x d) |
|---|---|---|
| `back-left-corner` | floor x -10 to -8.4, z -8 to -6.6, beside the left shelf | 1.6 x 3.2 x 1.4 |
| `back-right-corner` | floor x 9 to 10, z -6.6 to -5.2, in front of the right edge of the trophy cabinet | 1.0 x 3.2 x 1.4 |
| `right-wall-floor` | floor x 8.8 to 10, z -5 to -1.6, against the right wall below the `right-wall` slot | 1.2 x 2.6 x 3.4 |
| `front-left` | floor x -10 to -7, z 8 to 10.4 | 3 x 3 x 2.4 |
| `front-centre` | floor x -2 to 2, z 8 to 10.4 | 4 x 2.4 x 2.4 |
| `front-right` | floor x 7 to 10, z 8 to 10.4 | 3 x 3 x 2.4 |
| `back-wall-high` | back wall, a band centred at x 0 and y 4.4 (y 3.8 to 5.0) | 18 x 1.2 x 0.3 |
| `left-wall-high` | left wall, a band centred in the middle of the wall at y 4.4 | 18 x 1.2 x 0.3 |
| `right-wall-high` | right wall, the same band | 18 x 1.2 x 0.3 |
| `right-wall` | right wall, centred at z -3.3 and y 2.3 (y 1.1 to 3.5) | 3.4 x 2.4 x 0.3 |
| `front-wall` | front wall, centred at x 0 and y 2.5 (y 0.8 to 4.2) | 16 x 3.4 x 0.3 |
| `desk` | on each of the 16 desks, on the outer side of the screen, facing the sitter | 0.36 x 0.36 x 0.3 |

Notes:

- The back wall below the high band holds the fixtures (shelves, ticket board,
  idea board, rack, trophy cabinet), so the only back-wall slot is the high
  band. The left wall holds the coffee corner, the arcade and the door.
- The `front-*`, `right-wall` and `right-wall-floor` slots are on the near
  side of the room. When a fully furnished office uses any of them, its base
  room leaves out its own front dressing (waiting area, lounge, pictures and
  windows). In a `minimal` office there is none to leave out.
- The front slots are the nearest to the camera: low things (under 1.2 high)
  keep the view of the room clear. Tall props belong in the back corners.
- `tilt` tips a part about its width (x) axis before `rotate` turns it about
  the vertical: a flat cylinder with `tilt: 90` stands on its edge, facing the
  room, like a ship's wheel, a clock face or a round window. A tipped part
  takes the room of its tipped box, so a 1.4 wide disc tipped 90 is 1.4 tall.
- `spin` turns a part about its own axis, after tipping (a fan, a turntable,
  a wheel), and `float` bobs it a few centimetres up and down.
- A cylinder or cone is as wide as its `size` x and as deep as its `size` z,
  so give both the same value for a round one.
