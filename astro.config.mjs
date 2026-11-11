// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  build: {
    // Keep styles in files, so the Content-Security-Policy in public/_headers
    // does not need to allow inline styles.
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      // Keep scripts in files for the same reason.
      assetsInlineLimit: 0,
    },
  },
});
