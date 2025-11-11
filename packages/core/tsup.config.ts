import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    resolve: true,
    compilerOptions: {
      skipLibCheck: true, // Skip type checking of declaration files
      skipDefaultLibCheck: true,
    },
  },
  clean: true,
  external: [
    '@solana/web3.js',
    '@solana/spl-token',
    '@coral-xyz/anchor',
    '@x402-solana/core',
    'bn.js',
    'bs58',
  ],
  noExternal: [],
  treeshake: true,
  splitting: false,
});
