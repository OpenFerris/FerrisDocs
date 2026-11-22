# syntax=docker/dockerfile:1.7
#
# FerrisDocs build environment.
#
# The site is a standalone Node project: it does not need the Rust toolchain or
# either Ferris workspace. The image is pinned by tag and digest so every
# checkout builds with the same Node and the same lockfile resolution.
#
#   docker compose run --rm docs sh -lc 'npm ci && npm run build'
#   docker compose run --rm docs sh -lc 'npm run dev -- --host 0.0.0.0'
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

WORKDIR /site

ENV npm_config_cache=/tmp/npm-cache \
    CI=true

CMD ["bash"]
