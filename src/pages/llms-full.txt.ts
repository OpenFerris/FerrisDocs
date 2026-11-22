import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

/**
 * `llms-full.txt` — every documentation page concatenated as Markdown.
 *
 * Useful for a single-shot context window. Each page is preceded by a stable
 * HTML comment with its slug so a consumer can cite the source.
 */
export const prerender = true;

// Archived copies live under `src/content/docs/<version>/` (for example
// `0.2/`). They are a frozen snapshot, so the LLM index points at the current
// docs only; a consumer that needs a specific release can still fetch its
// `/<version>/<slug>.md`.
const VERSIONED = /^\d+(?:\.\d+)+\//;

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');

  const pages = docs
    .filter((entry) => entry.id !== '404' && !VERSIONED.test(entry.id))
    .map((entry) => ({
      slug: entry.id === 'index' || entry.id === '' ? 'index' : entry.id.replace(/\/index$/, ''),
      title: entry.data.title,
      description: entry.data.description ?? '',
      body: entry.body ?? '',
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const chunks: string[] = [
    '# Ferris — complete documentation',
    '',
    '> Generated from docs-site/src/content/docs. Every page is current; there is no changelog or historical section here.',
    '',
  ];

  for (const page of pages) {
    chunks.push(
      `<!-- page: ${page.slug} -->`,
      '',
      `# ${page.title}`,
      '',
      page.description ? `> ${page.description}` : '',
      '',
      page.body.trim(),
      '',
      '---',
      '',
    );
  }

  return new Response(chunks.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
