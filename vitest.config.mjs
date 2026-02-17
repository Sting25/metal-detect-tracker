import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        setupFiles: ['./tests/setup.js'],
        testTimeout: 10000,
        sequence: { concurrent: false },
        fileParallelism: false,
        globals: true,
    },
});
