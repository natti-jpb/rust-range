import { rmSync } from 'node:fs';
import { defineConfig } from 'vite';

// public/rust-assets/ e public/mc-assets/ = conteúdo extraído dos jogos, só para uso local: nunca entram no build.
const stripRustAssets = {
  name: 'strip-rust-assets',
  apply: 'build',
  closeBundle() {
    for (const d of ['rust-assets', 'mc-assets']) rmSync(new URL(`./dist/${d}`, import.meta.url), { recursive: true, force: true });
  },
};

export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 900 }, plugins: [stripRustAssets] });
