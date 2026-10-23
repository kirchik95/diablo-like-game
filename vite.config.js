import { defineConfig } from 'vite';

// Only chunking is customised; every other build setting stays at Vite defaults.
// The statically imported part of Babylon.js goes into size-capped vendor chunks,
// game code stays in the entry chunk, and Babylon's lazily imported shaders and
// texture loaders keep their own on-demand chunks.
export default defineConfig({
  build: {
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
          ],
        },
      },
    },
  },
});
