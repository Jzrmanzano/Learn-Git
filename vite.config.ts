import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Multi-page build: each HTML file at the project root becomes its own page in dist/.
const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: page('./index.html'),
        learn: page('./learn.html'),
        cheatsheet: page('./cheatsheet.html'),
      },
    },
  },
});
