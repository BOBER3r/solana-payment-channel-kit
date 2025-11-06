import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    express: 'src/express.ts',
    nestjs: 'src/nestjs.ts',
    fastify: 'src/fastify.ts',
  },
  format: ['cjs', 'esm'],
  dts: {
    resolve: true,
    compilerOptions: {
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    },
  },
  clean: true,
  external: [
    '@solana/web3.js',
    '@solana/spl-token',
    'express',
    'fastify',
    '@nestjs/common',
    '@nestjs/core',
  ],
  noExternal: [],
  treeshake: true,
  splitting: false,
});
