/// <reference types="astro/client" />

/**
 * The workspace version, injected by `astro.config.mjs` from `Cargo.toml`.
 *
 * The site reads it instead of duplicating the number in components or pages,
 * so a release only bumps the Rust workspace and the WIT contract.
 */
declare const __FERRIS_VERSION__: string;

/** Workspace member count, read from `[workspace] members` in `Cargo.toml`. */
declare const __FERRIS_CRATES__: number;

/** Pinned Rust channel, read from `rust-toolchain.toml`. */
declare const __FERRIS_TOOLCHAIN__: string;
