// GitHub Pages serves this repository as a project site:
// https://openferris.github.io/FerrisDocs/
//
// Astro prefixes assets and Starlight's generated navigation, but plain
// Markdown links (`[x](/conceptos/)`) and the `llms.txt` index keep their
// root-relative form. This step rewrites those few leaves after the build so
// the deployed site is self-consistent; it is idempotent and skips paths that
// already carry the base.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const BASE = '/FerrisDocs';

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

function prefixHtml(text) {
  return text
    .replace(/\b(href|src)="\/(?!\/|FerrisDocs\/)/g, `$1="${BASE}/`)
    .replace(/\b(href|src)="\/"/g, `$1="${BASE}/"`);
}

function prefixMarkdown(text) {
  return text.replace(/\]\(\/(?!\/|FerrisDocs\/)/g, `](${BASE}/`);
}

let changed = 0;
for await (const path of walk(DIST)) {
  if (path.endsWith('.html')) {
    const before = await readFile(path, 'utf8');
    const after = prefixHtml(before);
    if (after !== before) {
      await writeFile(path, after);
      changed += 1;
    }
  } else if (path.endsWith('.md') || path.endsWith('.txt')) {
    const before = await readFile(path, 'utf8');
    const after = prefixMarkdown(before);
    if (after !== before) {
      await writeFile(path, after);
      changed += 1;
    }
  }
}
console.log(`prefix-base: rewrote ${changed} file(s) with ${BASE}`);
