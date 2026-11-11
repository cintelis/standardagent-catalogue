# Standard Agent Catalogue

A static site that lists the Standard Agent packages published on npm. It hosts
no packages. It reads the public npm registry when it builds, and it links back
to npm.

The [Standard Agent Specification](https://standardagentspec.org) defines a
packed agent as an npm package, so npm is the registry and this site is an index
over it.

## What it lists

| Page | Source |
|---|---|
| Agents (`/`) | npm packages with the `standardagent` keyword and a valid `standardagent` field in `package.json` |
| Agent page (`/package/<name>/`) | The package's entry agents, effects, thread endpoints, parent hooks, and npm details |
| Ecosystem (`/ecosystem/`) | npm packages with the `standardagents` keyword: providers, clients, and tooling |
| Runtimes (`/runtimes/`) | `src/data/runtimes.json`, kept by hand |
| Publish (`/publish/`) | How to publish a package so that the catalogue lists it |
| `/catalogue.json` | The same data as JSON |

A package with the `standardagent` keyword but no valid field is left out, and
the build prints its name.

## Commands

```bash
pnpm install
pnpm dev      # Start the dev server
pnpm build    # Read npm and build the site into dist/
pnpm preview  # Serve dist/
pnpm test     # Build from tests/fixtures into dist-test/, then check the result
```

`pnpm build` needs network access to `registry.npmjs.org`. A registry failure
fails the build, so a broken read never publishes an empty catalogue.

## Keeping it current

The data is as fresh as the last build. Rebuild and redeploy on a schedule, for
example once a day, from the host's scheduled builds or a CI cron job. `dist/` is
plain static files and deploys to any static host.

`public/_headers` sets security headers in the format that Cloudflare Pages and
Netlify read. Another host needs the same headers in its own configuration.

## How it treats package data

Every field of a package is written by its publisher, so the catalogue treats
it as untrusted. `src/lib/npm.ts` is the only code that reads the registry:

- It checks each field's type and caps its length.
- It keeps a link only when it is a plain `http` or `https` URL without
  credentials.
- It takes the package's name and keywords from the package's own manifest, not
  from the search index.
- Pages render every value as text. No page renders a README or other HTML from
  a package.

`tests/fixtures` includes a hostile package, and `tests/site.test.mjs` checks
that none of its markup or links reach the built pages.

A listing is automatic. It is not a review, an endorsement, or a statement that
a package conforms to the specification.

## Structure

```text
src/
├── lib/npm.ts                 # Reads and validates npm data, once per build
├── data/runtimes.json         # The runtime list
├── layouts/Base.astro         # Header, navigation, footer
├── components/
│   ├── PackageCard.astro      # One package in a list
│   └── Filter.astro           # Search box that filters the cards on a page
├── pages/
│   ├── index.astro            # Agents
│   ├── ecosystem.astro
│   ├── runtimes.astro
│   ├── publish.astro
│   ├── catalogue.json.ts
│   └── package/[...name].astro
└── styles/global.css
tests/
├── fixtures/                  # Saved registry responses for the tests
└── site.test.mjs
```
