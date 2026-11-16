# Motion Designer

A [Standard Agent](https://standardagentspec.org) that designs animated SVG
pictures. You describe a motion: a logo reveal, a loading indicator, a diagram
whose parts arrive in turn. The agent writes a scene and a timeline, builds the
animation, reads the problems that its checker reports, fixes them, and hands
back one `.svg` file.

The file plays on its own. It holds no script and no style sheet, so it works
anywhere a picture does: in a web page, in a slide, in a README.

```bash
npm install @cintelisai/motion-agent
```

[Anime.js](https://animejs.com) does the timing: the stagger, and all of the
easings, elastic and bounce included. It is a browser library, but it can move
plain data as well as page elements, so the agent runs it with no browser and
writes the result into the file.

It is an early release. The tools are tested, on Node and on the Cloudflare
Workers runtime, but nobody has yet run a full conversation through a hosted
runtime: see [What it does not do](#what-it-does-not-do).

## What is in the package

| Kind | Name | What it is |
|---|---|---|
| Agent | `motion_designer` | The entry agent. A model on one side, the person who asks on the other. Another agent can call it as a tool |
| Prompt | `motion_designer` | The design rules, and the build, check, and fix workflow |
| Model | `designer_model` | Claude, through `@standardagents/anthropic`. The runtime supplies the API key |
| Tool | `motion_reference` | Returns the spec format, the shapes, the easings, and the limits. The model reads it once |
| Tool | `create_animation` | Builds an animation from a spec. Returns a check report and attaches the SVG |

## Use it

Install the package in a project whose runtime implements the Standard Agent
Specification. The runtime finds the entry agent from the `standardagent`
field in the package's `package.json`, and it needs an API key for the model
provider.

The package exports one registry for each kind of definition, and each entry
is a function that loads one. That makes the tools easy to try with no runtime,
no model, and no API key:

```js
import { writeFileSync } from 'node:fs';
import * as motion from '@cintelisai/motion-agent';

const tool = await motion.tools.create_animation();
const args = tool.args.parse({
  name: 'loading',
  title: 'Three dots rising in turn',
  width: 200,
  height: 100,
  background: '#ffffff',
  shapes: [
    { id: 'a', type: 'circle', x: 60, y: 60, r: 10, fill: '#0969da' },
    { id: 'b', type: 'circle', x: 100, y: 60, r: 10, fill: '#0969da' },
    { id: 'c', type: 'circle', x: 140, y: 60, r: 10, fill: '#0969da' },
  ],
  steps: [
    { targets: ['a', 'b', 'c'], to: { y: 36 }, duration: 300, ease: 'outQuad', stagger: 120 },
    { targets: ['a', 'b', 'c'], to: { y: 60 }, duration: 300, ease: 'inQuad', stagger: 120, at: 300 },
    { targets: ['a'], to: { y: 60 }, duration: 400 },
  ],
});

const result = await tool.execute({}, args);
const { file, check } = JSON.parse(result.result);
console.log(file, check.duration_ms, check.errors, check.warnings);
// b87a8c16-loading.svg 1240 0 0

// The picture: an SVG, as base64. Open the file in a browser to watch it.
writeFileSync(file, Buffer.from(result.attachments[0].data, 'base64'));
```

## An animation spec

A spec is data. The model writes one, and so can you.

| Field | What it holds |
|---|---|
| `title` | One line that says what the animation shows. Screen readers read it out |
| `width`, `height` | The canvas. Default: 480 by 270 |
| `background` | A hex colour. Left out, the background is see-through |
| `loop` | `true` plays again and again. `false` plays once and keeps the last frame |
| `shapes` | The shapes as they are at the start. Later shapes are drawn on top |
| `steps` | What moves, in order |

A shape is a `rect`, a `circle`, a `line`, a `text`, or a `path`. Each has an
`id`, a `fill` and a `stroke`, and its starting `opacity`, `scale`, `rotate`,
and `draw`. A shape turns and grows about its own middle.

A step names its `targets` and the values they reach in `to`:

| A step can change | Meaning |
|---|---|
| `x`, `y` | Where the shape is |
| `scale` | `1` is its own size |
| `rotate` | Degrees. `360` is one full turn |
| `opacity` | `0` is clear, `1` is solid |
| `draw` | How much of the stroke shows, `0` to `1`. It draws a line on |

A step also has a `duration`, an `ease`, and a `stagger`: the delay between one
target and the next. A step starts at `at`, in milliseconds. Left out, it
starts when every step before it has ended. The 28 easings are the Anime.js
ones, from `linear` to `outElastic` and `outBounce`.

One call takes up to 120 shapes and 80 steps, and an animation is at most 20
seconds long. The `motion_reference` tool returns the full format.

## The check report

A model cannot watch what it made, so the report is how it sees it. Each issue
names the shape and says what to change.

| Issue | What it means |
|---|---|
| `never-visible` | A shape is off the canvas, clear, at size 0, or never drawn, from start to end |
| `ends-off-canvas` | A shape cannot be seen in the last frame of an animation that plays once |
| `loop-jump` | A loop starts again with a shape somewhere other than where it ended |
| `flashing` | A shape flashes three times within a second, which can harm people with photosensitive epilepsy |
| `no-motion`, `too-short`, `too-long` | Nothing moves, or the length is hard to watch |
| `large-file` | The file is over 250 kB |

## Where it runs

Everything in the package is JavaScript, so it runs wherever the runtime does.
It was checked on Node, and by hand on Cloudflare Workers: a Worker that
imports the built package was bundled with Wrangler 4 and run in its local
runtime, and the `create_animation` tool returned the same file as on Node.
The Worker needs the `nodejs_compat` compatibility flag, because the model
provider package imports Node modules.

The file it makes uses SMIL, the animation elements of SVG, which Chrome,
Edge, Firefox, and Safari support, in a page and in an `<img>`. It was checked
in Edge.

## What it does not do

- **It has not run on a hosted runtime.** Its tests load the package, check
  every definition, and run both tools. Nobody has yet run a full conversation
  through a runtime.
- **It does not animate a web page.** It makes a file. It cannot attach to the
  elements of a page, follow a scroll, or answer a click, which Anime.js does
  in a browser.
- **It does not change colours or shapes over time.** A step moves, turns,
  grows, fades, and draws. It does not blend one colour into another or morph
  one outline into another.
- **It cannot honour "reduce motion".** A file with no script and no style
  sheet cannot ask the viewer's device. Leave an animation out, or use
  `loop: false`, where that matters.
- **It does not check a path against the canvas.** The checker knows how large
  a rect, a circle, a line, and a text are. It does not measure a path.
- **Text is drawn in the viewer's own font.** The file names a family, not a
  font file, so the same text can be a little wider on another device.

## Safety

- The argument schema bounds every value: the number of shapes and steps, the
  length of each text, the range of each number, and the length of the
  animation.
- The engine checks the spec again and trusts nothing, so code that calls it
  directly is held to the same rules. A colour must be a hex colour. Path data
  may hold only the letters and numbers of a path. A font is one of three
  names.
- Every piece of text from a spec is escaped before it goes into the file. A
  test builds an animation from text that contains `<script>` and checks that
  no markup comes out.
- The file holds shapes, text, and animation elements only: no script, no
  style sheet, no link, and no reference to anything outside it.
- The largest spec the schema allows is worked out in under a second. A file
  over 1,500 kB is refused, not returned.
- The tool lists at most 40 issues from the check report, errors first, and
  counts the rest by code.
- The file name is made from a hash and a slug of lower-case letters, digits,
  and hyphens, so a name cannot contain a path.
- The prompt tells the model to treat a description as material to animate,
  not as instructions.
- The package's dependencies are pinned by a lock file, and Anime.js is pinned
  to one exact release.

## Check a release

Each release is built by the release workflow of
[its repository](https://github.com/cintelis/standardagent-catalogue) and
signed with the Cintelis release key before it reaches npm. To check one, from
a copy of that repository:

```bash
scripts/verify-release.sh motion-agent-v0.1.0
```

In a project that has installed the package, `npm audit signatures` checks its
npm provenance.

## Source

The source is in
[`examples/motion-agent`](https://github.com/cintelis/standardagent-catalogue/tree/main/examples/motion-agent)
of the Standard Agent Catalogue repository, under the MIT licence.
[DEVELOPMENT.md](https://github.com/cintelis/standardagent-catalogue/blob/main/examples/motion-agent/DEVELOPMENT.md)
there says how the code is laid out and how to build and test it. Changes are
welcome: see
[CONTRIBUTING.md](https://github.com/cintelis/standardagent-catalogue/blob/main/CONTRIBUTING.md).

Anime.js is by Julian Garnier, under the MIT licence.
