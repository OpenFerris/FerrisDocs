# AGENTS.md — FerrisDocs

Operating contract for any agent (or human) working on **FerrisDocs**, the
public documentation site of Ferris. It describes the tree as it exists today;
verify before trusting it and update it when reality changes.

Read §0 (build environment), §2 (the site) and §5 (branches) first.

---

## 0. Build environment — Node only, no Rust checkout

FerrisDocs is a standalone **Astro + Starlight** project. It does not read a
sibling `Cargo.toml`, does not compile Rust and does not depend on the
`FerrisCore`/`FerrisFramework` checkouts.

| Fact | Value |
|---|---|
| Runtime | Node **24** (`package.json` declares `>=22.23.4`; the image pins `node:24.22.3`) |
| Framework | Astro **7** + `@astrojs/starlight` + `starlight-versions` |
| Image | `ferris-docs`, built from `Dockerfile` |
| Orchestration | `compose.yaml` (service `docs`, port `4321`) |
| Site | <https://openferris.github.io/FerrisDocs/> |
| Deploy base | `/FerrisDocs` (`astro.config.mjs`), project page on GitHub Pages |

### Canonical commands

```bash
docker compose run --rm docs sh -lc 'npm ci && npm run build'
docker compose run --rm docs sh -lc 'npm run dev -- --host 0.0.0.0'
```

- `node_modules/` lives in the `docs-node-modules` named volume, so the host
  never gets a root-owned dependency tree. `dist/` is written as the invoking
  UID/GID.
- Node 24 on the host is acceptable for this repository (it is a Node project,
  not the Rust workspace). Do not run `cargo`/`rustc` here for any reason.
- Never commit `node_modules/`, `dist/` or `.astro/`.
- `package-lock.json` is **tracked**; the site is a deployable artifact and its
  dependency graph must stay pinned like `Cargo.lock`. Use `npm ci` in CI and
  `npm install` only when `package.json` changes.

---

## 1. Compaction & continuity protocol

A checkpoint, handoff or summary MUST carry, in this order:

1. **The main task, verbatim and complete**, including every clause of a
   multi-part order.
2. **What is needed to avoid re-exploring**: files/pages already read
   (`path:line`), commands run and results, artifacts changed, decisions and
   why.
3. **Every explicit user rule** (language, paths, prohibitions, scope limits)
   plus this file's rules that bear on the task. User rules outrank defaults.
4. **Current position and next step**: done, in progress, next action, blocked
   items, unverified claims.

Never claim done what you did not verify. Keep it small but lossless.

---

## 2. What this site is

Two portals, one site:

- **Ferris** — architecture, DocTypes, Desk, CLI, API, configuration and
  operations.
- **`/apps/**`** — WASM apps and the component contract. It is **language
  agnostic**: an app page must not require Rust, cite Ferris crates/traits or
  link to internal architecture. Rust is one option, in
  `/apps/languages/rust/`.

```text
FerrisDocs/
├── astro.config.mjs          # Starlight, explicit sidebar, site/base, version
├── project.json              # version, crates, toolchain, WIT and repo names
├── package.json              # scripts + pinned dependencies
├── scripts/prefix-base.mjs   # prefixes plain Markdown links with /FerrisDocs
├── src/
│   ├── content.config.ts     # `docs` and `versions` collections
│   ├── content/docs/         # current pages (Spanish prose)
│   ├── content/docs/<slug>/  # archived copies (0.2/) — frozen, never edit
│   ├── content/versions/     # frozen sidebar per archived version
│   ├── components/           # Footer.astro, landing/HeroMeta.astro
│   ├── data/footer.ts        # footer links as data
│   ├── pages/                # llms.txt, llms-full.txt and <slug>.md
│   ├── styles/               # custom.css entry + tokens/base/shell/content/landing/footer
│   └── assets/logo.svg
└── public/favicon.svg
```

### Facts the shell derives, never hardcodes

`astro.config.mjs` reads `project.json` and injects:

- `__FERRIS_VERSION__` — the workspace version (also in both `Cargo.toml`, both
  `ferris.wit` copies and `CHANGELOG.md`).
- `__FERRIS_CRATES__` — **21** (9 Core + 12 Framework).
- `__FERRIS_TOOLCHAIN__` — Rust **1.98.1**.

The release process bumps `project.json` together with the two Rust workspaces.
Never write the number into a page or a component.

### The deploy base

The site is a GitHub Pages **project page**, so it lives under `/FerrisDocs/`.

- `astro.config.mjs` sets `site: 'https://openferris.github.io'` and
  `base: '/FerrisDocs'`.
- Astro prefixes assets and generated navigation automatically.
- Plain Markdown links (`[x](/conceptos/)`) and the LLM index keep their
  root-relative form; `scripts/prefix-base.mjs` rewrites them after the build
  (idempotent, skips paths that already carry the base).
- `npm run build` is `astro build && node scripts/prefix-base.mjs`.
- `llms.txt` builds absolute URLs from `site` + `import.meta.env.BASE_URL`, so an
  agent reading it outside the browser gets `/FerrisDocs/…` links.

Never remove `base` or the prefix step without moving to a user/organisation
page; every internal link would 404.

---

## 3. Content rules

- **Spanish** prose and headings. Identifiers, commands, endpoint names and
  types keep their real spelling, in backticks. Code and code comments stay
  **English**.
- **Describe the code that exists**, not a roadmap, changelog or audit. No
  historical decisions, past bugs, `AUDIT` IDs or "before/after" sections.
  Every endpoint, config key, feature, WIT signature and CLI flag must be
  checked against the source. A limitation is written as a limitation (and,
  where the code is fail-closed, the error the user will see).
- **Two workspaces**: Core is 9 crates, Framework is 12; `FerrisDocs` is the
  third repository and is not a Rust workspace. Framework references Core by
  `../../FerrisCore/…`; the checkouts must be siblings.
- **Frontmatter**: every page declares at least `title` and `description`.
- **Links**: internal links are absolute and end with `/`
  (`/conceptos/naming/`), which is what the sidebar slugs use. Section indexes
  use `link: '/section/'`; the rest use `slug`.
- **The sidebar is explicit.** Adding a page means adding its `slug` to the
  `sidebar` in `astro.config.mjs`; a page not linked from anywhere is a bug.
  Removing or renaming a page means updating every inbound link. Under Astro 7
  a nested `index.md` is id `section/index`, so a section index uses
  `link: '/section/'`, not `slug: 'section'`.
- **A page is 80–220 lines.** A page that needs 400 is two pages or a prune.
- **LLM output is part of the site.** `/llms.txt`, `/llms-full.txt` and
  `/<slug>.md` are generated from the collection; a new page is included
  automatically. Keep the Markdown self-contained, because that is what an agent
  reads.

### Versioned docs

- Current pages live in `src/content/docs/`.
- Published versions are archived by `starlight-versions` in
  `src/content/docs/<slug>/` plus `src/content/versions/<slug>.json`.
- **Edit the current copy, never the archive.**
- `/llms.txt` and `/llms-full.txt` exclude archived copies.

---

## 4. Definition of Done (gates)

| Gate | Command | When |
|---|---|---|
| Install | `npm ci` | always (or when `package-lock.json` changes) |
| Types + content | `npm run check` | always |
| Build | `npm run build` | always |
| Links | every sidebar `slug` has a file; every internal `](/…)` resolves through the base prefix | when adding, moving or renaming a page |
| Diff review | `git diff` | always |

`npm run build` is the release gate: it fails on a missing sidebar entry, a
broken collection entry or a bad frontmatter. A warning from Astro/Starlight that
concerns content is treated as a defect, not noise.

When a change alters public behaviour — a command, flag, endpoint, config
section, DocType, fieldtype, WIT signature or feature gate — update the matching
page **in the same change**. A stale page is a defect.

---

## 5. Branches and deployment

Same branch layout as FerrisCore and FerrisFramework:

| Branch | Role |
|---|---|
| `develop` | **Default.** Integration; every working PR targets it. |
| `master` | Production. Only `release/*` and `hotfix/*` merges land here. |
| `feature/*`, `fix/*` | Daily work, branched from `develop`. |
| `release/*` | Freeze before publishing; merged into `master` and back into `develop`. |
| `hotfix/*` | Urgent patch from `master`; merged into `master` and `develop`. |

- Protected branches: direct pushes to `master` and `develop` are disabled; a PR
  and the `Docs` CI workflow are required.
- Commit subjects: `feat(scope): …`, `fix(scope): …`, `docs(…): …`,
  `refactor(…): …`, `wip: …`.
- **GitHub Pages deploys from `master`** (and `workflow_dispatch`) through
  `.github/workflows/pages.yml`: `configure-pages` → `upload-pages-artifact`
  (`dist`) → `deploy-pages`. A merge into `master` publishes the site; `develop`
  only runs the build check in `ci.yml`.
- Pages is configured with `build_type=workflow` in the repository settings; if
  it is ever switched back to "branch", the workflow stops being the source of
  truth.
- The site has no server: it is a static artifact. There is no runtime
  configuration, no database and no secret.

---

## 6. Release

The site is versioned with the code, not on its own.

1. The Rust release bumps both `Cargo.toml`, both `ferris.wit` copies,
   `CHANGELOG.md` and this repository's `project.json` to the same number.
2. `npm run check && npm run build` must be green with the new `project.json`.
3. The bump reaches `master` with the release merge; the Pages workflow
   publishes the site.
4. Archive the previous docs version with `starlight-versions` (copy into
   `src/content/docs/<slug>/` and add `<slug>.json`); the archive is frozen.
5. Never tag a release while `project.json` and the Rust workspaces disagree.

---

## 7. Verification discipline

1. **Locate by grep, confirm by reading.** Every `file:line` was actually read.
2. **Negatives are proven by absence**, quoting the `grep`.
3. **Report what was not verified.**
4. **Do not invent APIs.** If a flag/endpoint is not in the source, it does not
   belong in a page.
5. Note what was already correct and must not be disturbed.

Final report: what changed, which pages, the exact commands run and their
result, and anything left unverified or knowingly skipped.

---

## 8. Documentation map

| File | What it is |
|---|---|
| `AGENTS.md` | This contract. |
| `README.md` | Public entry point for the docs repository. |
| `project.json` | Version, crate count, toolchain and repository names. |
| `astro.config.mjs` | Site/base, explicit sidebar, version injection and plugins. |
| `../FerrisCore/AGENTS.md` | Contract for the base workspace. |
| `../FerrisFramework/AGENTS.md` | Contract for the product workspace. |

---

## 9. One-page checklist

- [ ] Frontmatter with `title` and `description`.
- [ ] Page in the explicit sidebar, in the correct block.
- [ ] Internal links absolute and with a trailing slash; no `docs-site/` path.
- [ ] Examples copyable, with real keys and flags verified against the source.
- [ ] Facts current: version `0.3.0`, Rust `1.98.1`, 21 crates (9 + 12), WIT
      `ferris:framework@0.3.0` — and none of them hardcoded in a page.
- [ ] `npm run check` and `npm run build` pass.
- [ ] No `node_modules/`, `dist/` or `.astro/` staged.
- [ ] `git diff` reread.
- [ ] If context was compacted: the summary keeps the task, the context, the
      rules and the next step.
