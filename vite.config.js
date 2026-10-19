import { rmSync } from 'node:fs';
import { defineConfig } from 'vite';

// public/rust-assets/ = conteúdo extraído do jogo, só para uso local: nunca entra no build.
const stripRustAssets = {
  name: 'strip-rust-assets',
  apply: 'build',
  closeBundle() {
    rmSync(new URL('./dist/rust-assets', import.meta.url), { recursive: true, force: true });
  },
};

export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 900 }, plugins: [stripRustAssets] });
