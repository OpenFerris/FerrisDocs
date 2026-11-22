# Contributing to FerrisDocs

FerrisDocs is the public documentation site of Ferris (Astro + Starlight). The
site describes the code in
[`FerrisCore`](https://github.com/OpenFerris/FerrisCore) and
[`FerrisFramework`](https://github.com/OpenFerris/FerrisFramework); it does not
compile Rust.

## Getting started

1. Fork and clone this repository.
2. Read [`AGENTS.md`](AGENTS.md) for the content rules, the explicit sidebar and
   the deployment model.
3. Branch from `develop` (`feature/…`, `fix/…`, `docs/…`) and open the PR against
   `develop`. `master` is production and publishes to
   <https://openferris.github.io/FerrisDocs/>.

## Checks

```bash
npm ci
npm run check     # astro check
npm run build     # astro build + /FerrisDocs prefix
```

Pages are written in Spanish; identifiers, commands and types keep their real
spelling. Every page needs `title` and `description`, and must be linked from
the `sidebar` in `astro.config.mjs`.

## Code of conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
