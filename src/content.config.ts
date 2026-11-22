import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { docsVersionsLoader } from 'starlight-versions/loader';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Sidebar + excluded-page metadata that `starlight-versions` writes when it
  // archives a released version under `src/content/docs/<slug>/`.
  versions: defineCollection({ loader: docsVersionsLoader() }),
};
