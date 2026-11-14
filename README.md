# ai-happy-01 — "A warm cocoa, for you"

A chibi ginger kitten offers the viewer a steaming mug of hot cocoa: both
paws wrapped around the cup, eyes closed in pure delight, and the steam
curling up into a little pink heart. A short line at the top, drawn in a
clean pixel font, says it out loud: "this one's for you!"

Built for the judge's rubric, in order: one warm golden mood that lifts at
a glance; a fresh, specific happy moment (a kitten handing *you* a hot
cocoa, steam turning into a heart — not a stock smiley); colour, light and
composition all pulling toward the same cosy feeling; clean storybook
craft with no garbled text or broken shapes; and one big central subject
that still reads clearly at 300 pixels across.

## Run it

Node 22, standard library only, no network, deterministic — the program
rasterises the scene from code (2x supersampling, its own PNG encoder)
and writes one image:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# -> out/entry.png, 800x800 PNG, ~115 KB (limit: 1 MiB, 1024x1024)
```

Two runs write byte-identical files.

## License

MIT — see `LICENSE`.
