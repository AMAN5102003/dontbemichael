# Office floor: department plates and glass monitors

Status: design approved and built (owner, 2026-10-15). HR is the department's name; a long word widens a one person pad just enough; an office tucked behind another stays partly hidden, like the rest of that pod.

## Problem

Many business owners don't know The Office, so a floor of names (Jim, Oscar, Toby)
doesn't tell them who does what. The department showed only on a pod's full card;
an idle pod, the usual state, shows a chip with names alone. Separately, the desk
monitors read as old, thick framed screens.

## Approved direction

Explored on the real studio (studio lab, Harbor & Pine) after HTML mockups of chips,
signs, per person jobs and floor zones. The owner chose the department on the office
itself, then tuned it live:

### Department plate on each office

- A plate lying on the pod's pad, right in front of the chairs, at the floor's angle
  (the same plane as Michael's nameplate): `matrix(1,0.5,-1,0.5,x,y)` at the plate's
  center.
- Center: grid `gy + chairEnd + 0.1`, where `chairEnd` is 0.53 for one or two desks and
  1.15 (0.62 + 0.53) for three or four, so it sits right after the front chair's back
  with no gap (owner: "reduce it to absolute minimum").
- The pad grows at the front only by what the plate needs:
  `max(0, chairEnd + 0.1 + 0.12 - hd)` grid units (owner: no needless lengthening).
- Plate: white at 92%, 0.7 px border in the department `acc`, `r` 2.2, 9 px tall,
  `10 + letters x 4.6` px wide; text in Sora 700, 5.8 px, letter spacing 0.5, uppercase,
  in the department `acc`.
- The word is the department name (`studio.dept.*`), so it holds however people are
  renamed, and a hire from a pack card shows that card's department.

### Glass monitors

- Every desk monitor, and Michael's two in the center office, is a frameless glass
  slab: no black bezel and no white edge (owner: "just keep the glass").
- Slab faces: top `rgba(220,228,246,0.35)`, left `rgba(226,234,250,0.2)`, right
  `rgba(200,210,236,0.35)`, 0.02 deep.
- Idle: the pane is `rgba(226,234,250,0.38)` with a soft white reflection
  (`rgba(255,255,255,0.55)`) across its left side.
- Busy (working, looping, thinking, compacting): the glass takes the color
  (department `acc` at about 13%, violet for thinking and compacting) and its lines
  scroll, using the existing scroll animation. Asking for help keeps coral, static.
- Dark theme: the screen halo drops to 25% so glass doesn't glow like a lit monitor.

Approved images and the live prototype:
`~/.gstack/projects/agentvivekkumar-dontbemichael/designs/floor-department-labels-20261015/`
(`real-glass2-zoom.png`, `studio-lab-office-plates-glass.html`, and `prototype.patch`, the
prototype's code against `src/renderer/src/scene/studio`).

## Decide at build time

- **The HR word.** The department is called "People" today; owners may know "HR"
  better.
- **Long words on one person offices.** "FRONT DESK" is wider than a one person pad;
  shorten the word or let the plate run to the pad's width at a smaller size.
- **Offices tucked behind another** (Marketing behind the front desk in the lab) show
  their plate partly hidden, like the rest of that pod today.
- Plates are small on a non Retina screen at the smallest window size; check there.

## Build notes

- `StudioArt.tsx` `Pod` (pad depth, plate) and `Station` / `Hub` (monitors). The
  prototype read `?floorLabel` and `?monitor` from the URL; the build makes both the
  default and removes the flags.
- DESIGN.md §8 (studio art) and §7.14 gain the plate and the glass.
- Re-shoot the reference screens (`npm run shoot`) and the studio lab after.
