import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * Raw Markdown for every documentation page: `/getting-started/instalacion.md`.
 *
 * The body is the source from `src/content/docs`, so it stays exactly what the
 * author wrote (minus frontmatter). The title and description are prepended so
 * a fetched page is self-describing.
 */
export const prerender = true;

const slugOf = (id: string): string => {
  if (id === '' || id === 'index') return 'index';
  return id.replace(/\/index$/, '');
};

export const getStaticPaths = (async () => {
  const docs = await getCollection('docs');
  return docs
    .filter((entry) => entry.id !== '404')
    .map((entry) => ({
      params: { slug: slugOf(entry.id) },
      props: { entry },
    }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
  const { entry } = props as { entry: CollectionEntry<'docs'> };
  const body = [
    `# ${entry.data.title}`,
    '',
    entry.data.description ? `> ${entry.data.description}` : '',
    '',
    (entry.body ?? '').trim(),
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="${slugOf(entry.id).replaceAll('/', '-')}.md"`,
    },
  });
};
