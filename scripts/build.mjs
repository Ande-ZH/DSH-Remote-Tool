import { build } from 'esbuild'

await Promise.all([
  build({
    entryPoints: ['src/ui/index.js'],
    outfile: 'dist/client.js',
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    charset: 'utf8',
    external: ['react'],
    banner: { js: 'window.__ModuleLoader__.load({ id: "dsh-shared-remote", factory(require) {\nconst module = { exports: {} };' },
    footer: { js: 'return module.exports;\n} });' },
  }),
  build({
    entryPoints: ['src/magpie/remote.cjs'],
    outfile: 'dist/magpie-agent.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    charset: 'utf8',
  }),
])
