import { defineConfig } from 'vite';
import { versionPlugin } from './build/version-plugin.js';

// Chunking and the document/version update headers are customised.
// The statically imported part of Babylon.js goes into size-capped vendor chunks,
// Babylon's lazily imported shaders and texture loaders keep their own on-demand
// chunks, and game code is split three ways so the entry chunk keeps headroom:
// the art and layout data (JSON manifests), the monk panel with the game rules it
// imports (a group takes its modules' dependencies along), and the rest. All of
// them are static imports: strict execution order still runs each chunk before
// the code that needs it.
export default defineConfig({
  plugins: [versionPlugin()],
  build: {
    // Recorded sounds load after the first frame (src/sfx.js); inlined, they would
    // weigh on the entry chunk and arrive with the boot.
    assetsInlineLimit: (file) => (file.endsWith('.m4a') ? false : undefined),
    rolldownOptions: {
      output: {
        // The size-capped Babylon chunks import each other in a cycle; without strict
        // order a chunk can run before the chunk that defines its imports (Matrix).
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: 'babylon',
              test: /[\\/]node_modules[\\/]@babylonjs[\\/]/,
              tags: ['$initial'],
              // Pre-minification bytes; keeps each minified vendor chunk well under 500 kB.
              maxSize: 800 * 1024,
            },
            {
              // Asset manifests and authored layout data: plain data with no side effects.
              name: 'game-data',
              test: /[\\/]assets[\\/].*\.json$/,
              tags: ['$initial'],
            },
            {
              // HD-2D integration keeps the entry chunk's existing 80 kB reserve.
              name: 'hd2d',
              test: /[\\/]src[\\/]hd2d[\\/]/,
              tags: ['$initial'],
            },
            {
              // The «Монах» panel and, with it, the rules, items and skills it reads.
              name: 'monk-panel',
              test: /[\\/]src[\\/]monk-panel\.js$/,
              tags: ['$initial'],
            },
          ],
        },
      },
    },
  },
});
