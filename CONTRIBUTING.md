# Contributing

Thank you for helping. There are three ways to contribute, and the first needs
nothing from this repository.

| You want to | Do this |
|---|---|
| Get your own agent listed | [Publish it to npm](#list-your-own-agent). No pull request |
| Add or improve a sample agent | [Open a pull request](#add-a-sample-agent) against `examples/` |
| Change the catalogue site | [Open a pull request](#change-the-site) against `src/` |

## List your own agent

The catalogue has no accounts and no upload form. It reads npm. Publish a
package with these two markers, and it appears the next time the site is built,
which is once a day:

1. The keyword `standardagent` in the package's `keywords`.
2. A `standardagent` field in `package.json` whose `entryAgents` lists at least
   one agent.

```json
{
  "name": "standardagent-my-workflow",
  "version": "0.3.1",
  "type": "module",
  "main": "./dist/index.js",
  "keywords": ["standardagent"],
  "standardagent": {
    "entryAgents": ["my_agent"]
  },
  "peerDependencies": {
    "@standardagents/spec": ">=0.2.0"
  }
}
```

The quickest start is to copy [`examples/text-coach-agent`](examples/text-coach-agent)
into a repository of your own. It is a complete package with a build, tests, and
a README that explains each file. Before you publish your copy:

- Change `name`, `description`, and the agent's own names.
- Remove `"private": true`, which stops `npm publish`.
- Keep the `LICENSE` file, or replace it with your own.

A package that supports agents without being one, such as a model provider or a
client library, is listed under Ecosystem when it carries the `standardagents`
keyword.

To list a runtime, add an entry to `src/data/runtimes.json` in a pull request:
a name, a public link, and one factual sentence.

## Set up

You need:

- Node 22.23.4 or later, and pnpm. CI uses Node 24 and pnpm 12.11.2.
- For the sample agents only: Rust from [rustup](https://rustup.rs). Each
  sample's `rust-toolchain.toml` asks for the stable toolchain and the
  WebAssembly target, and rustup installs them on first use.

The catalogue and each sample are separate projects with their own
`pnpm-lock.yaml`. Install and test the one you are changing:

```bash
# The catalogue site
pnpm install
pnpm test        # Builds from tests/fixtures, then checks the result
pnpm dev         # Reads the live npm registry

# A sample agent
cd examples/text-coach-agent
pnpm install
pnpm test        # Builds the Rust, runs its tests, then tests the package
pnpm demo        # Runs the tool with no model and no API key
```

Everything runs on Windows, macOS, and Linux. Keep it that way: write a script
in Node, not in shell syntax, and build paths with `fileURLToPath`.

## Add a sample agent

A sample is there to be read and copied, so it should be small enough to follow
and complete enough to run.

1. Copy `examples/text-coach-agent` to a new folder under `examples/`.
2. Keep the structure: `src/agents`, `src/prompts`, `src/models`, `src/tools`,
   and `src/index.ts`, which exports one registry for each kind of definition.
3. Give it tests that load the built package and call each tool. They must not
   need a model or an API key.
4. Write a README that says what the sample does, how to run it, and what it
   does not do.
5. Add the folder's name to the `example` list in `.github/workflows/ci.yml`,
   so that CI builds and tests it.
6. Add a row to the "Sample agents" table in the root `README.md`.

What a sample must hold to:

- **Bound every input.** The tool's argument schema limits each length, count,
  and number. The specification allows only some Zod types in a tool's
  arguments: no strict objects and no tuples.
- **Bound the output.** A tool result goes back to the model, so cap what it
  can return.
- **Escape what you emit.** Text from a model or a user is untrusted when it
  goes into XML, HTML, SVG, or a style string.
- **Give WebAssembly no imports.** A module that imports nothing can reach no
  network, file, or clock.
- **Load on Cloudflare Workers.** Ship the `.wasm` file and import it under the
  `workerd` condition, as both samples do. A Worker may not compile a module
  from bytes at run time.
- **Pin dependencies.** Commit `pnpm-lock.yaml` and `Cargo.lock`.

The root README's "WebAssembly or a container" section says what belongs in
WebAssembly and what needs a sandbox service.

## Change the site

Three rules keep the site safe, because every field of a package is written by
its publisher:

- **Only `src/lib/npm.ts` reads the registry.** It checks each field's type,
  caps its length, and keeps only plain `http` and `https` links. A page takes
  its data from there and nowhere else.
- **Pages render values as text.** Do not use `set:html` with package data. A
  README is shown through `src/lib/readme.ts`, which keeps its structure and
  drops its HTML and pictures. Add what it should keep there, not in a page.
- **No inline script or style.** The Content-Security-Policy in
  `public/_headers` allows only the site's own files, so a `style` attribute or
  an inline `<script>` will not run. Fonts and images from other sites are
  blocked for the same reason.

When you change what the site reads or shows, add a case to
`tests/fixtures` and a check to `tests/site.test.mjs`. The fixtures include a
hostile package; keep it failing safely.

For a change to the look, check it in a light and a dark colour scheme, and at
a phone's width.

## Pull requests

- Branch from `main`, and keep one change to a pull request.
- Say what the change does and why, and how you tested it.
- CI must pass. It builds the site from the fixtures and runs its tests, and
  for each sample it runs `cargo fmt --check`, `cargo clippy` with warnings as
  errors, `cargo test`, the TypeScript typecheck, and the package tests.
- A pull request from a fork runs CI with read-only access and no secrets.
- Pin a new GitHub Action to a commit, with the release in a comment, as the
  existing workflows do.
- Write for a reader who is new to the code: plain sentences, and a comment
  where the reason is not obvious from the code.

A maintainer reviews each pull request. A listing in the catalogue is
automatic and is not a review; a sample in this repository is reviewed.

## For maintainers: how the site is published

Contributors do not deploy anything. A merged pull request reaches
[agents.cintelis.ai](https://agents.cintelis.ai) on its own.

`.github/workflows/deploy.yml` builds the site from the npm registry and
publishes it to Cloudflare every day at 03:17 UTC, on a push to `main` that
changes the site, and from the "Run workflow" button on the Actions page. It
publishes nothing when the registry read fails or when the build finds no
packages at all.

- It reads two repository secrets, `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. Without them it builds the site and deploys nothing.
- `wrangler.jsonc` names the Worker and the address.
- GitHub turns off a scheduled workflow after 60 days without a commit. It
  sends an email first, and the Actions page has a button to turn it back on.

## For maintainers: how a sample agent is released to npm

A release has a person in the middle. A machine builds it, a maintainer signs
it, and only then does it reach npm.

1. Set the version in the sample's `package.json`, and merge that.
2. Tag it and push the tag. The tag is the sample's folder, `-v`, and the
   version:

   ```bash
   git tag -a diagram-agent-v0.1.0 -m "Diagram agent 0.1.0"
   git push origin diagram-agent-v0.1.0
   ```

   `.github/workflows/release.yml` builds and tests the package on that
   commit, packs it, and puts the tarball and `checksums.txt` in a draft
   release, with signed build provenance. Nothing is on npm yet.
3. Sign the draft with the Cintelis release key:

   ```bash
   scripts/sign-release.sh diagram-agent-v0.1.0
   ```

   The script checks that the release workflow built the tarball, shows what
   is in it, and asks before it signs. Then it uploads `checksums.txt.sig`
   and publishes the release. The private key stays on the maintainer's
   machine. Its public half is `scripts/release_key.pub`.
4. Publishing the release starts the `npm` job. It checks the signature and
   the checksum, and sends that same tarball to npm with npm provenance.

npm publishes without a stored token, through a "trusted publisher": on
npmjs.com, the package's settings name this repository and the workflow file
`release.yml`. npm lets only a package that already exists name one, so the
first release of a new package needs an `NPM_TOKEN` repository secret. Remove
the secret once the trusted publisher is set.

Anyone can check a release with `scripts/verify-release.sh <tag>`.

## Report a security problem

Do not open a public issue for a security problem. Open a private report from
the repository's Security tab, under "Report a vulnerability". If that option
is not there, open an issue that asks a maintainer to contact you, without the
details.

A problem in a listed package belongs to that package's publisher, not to this
repository. Report it to them, or to npm.

## Licence

This repository is under the [MIT License](LICENSE). By contributing, you
agree that your contribution is under the same licence.
