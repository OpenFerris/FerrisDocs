import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

/**
 * `llms.txt` — a compact index for language models.
 *
 * The format is intentionally plain text: a title, a one-line summary and one
 * bullet per page pointing at its raw Markdown twin. Consumers that prefer a
 * single file can use `/llms-full.txt` instead.
 *
 * Links are absolute when the site origin is configured and root-relative
 * otherwise; both resolve on the same host.
 */
export const prerender = true;

// Archived copies live under `src/content/docs/<version>/` (for example
// `0.2/`). They are a frozen snapshot, so the LLM index points at the current
// docs only; a consumer that needs a specific release can still fetch its
// `/<version>/<slug>.md`.
const VERSIONED = /^\d+(?:\.\d+)+\//;

export const GET: APIRoute = async ({ site }) => {
  const docs = await getCollection('docs');
  const base = site ? site.toString().replace(/\/$/, '') : '';

  const pages = docs
    .filter((entry) => entry.id !== '404' && !VERSIONED.test(entry.id))
    .map((entry) => {
      const slug = entry.id === 'index' || entry.id === '' ? 'index' : entry.id.replace(/\/index$/, '');
      return {
        slug,
        title: entry.data.title,
        description: entry.data.description ?? '',
        section: slug === 'index' ? 'Inicio' : slug.split('/')[0],
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const sections = new Map<string, typeof pages>();
  for (const page of pages) {
    const list = sections.get(page.section) ?? [];
    list.push(page);
    sections.set(page.section, list);
  }

  const lines = [
    '# Ferris',
    '',
    '> Ferris is a metadata-driven, full-stack web framework in Rust with a WASM app contract. This index links to the current documentation in Markdown.',
    '',
    'Ferris has two audiences: the framework itself (architecture, DocTypes, Desk, CLI, API) and WASM apps (a language-agnostic component contract). The app section does not require Rust.',
    '',
  ];

  for (const [section, entries] of sections) {
    lines.push(`## ${section}`, '');
    for (const entry of entries) {
      const href = `${base}/${entry.slug}.md`;
      lines.push(`- [${entry.title}](${href})${entry.description ? `: ${entry.description}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Full text', '', `- [All documentation in one file](${base}/llms-full.txt)`, '');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
