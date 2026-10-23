import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path,
  // e.g. https://<user>.github.io/<repo>/ (GitHub Pages).
  base: './',
  build: {
    target: 'es2020',
  },
});
