import { resolve } from 'node:path'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('dist', { recursive: true })
const client = await build({
  entryPoints: ['src/ui/index.js'], outfile: 'dist/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', charset: 'utf8',
  external: ['react', 'react-dom'], write: false, minifyWhitespace: true, supported: { 'template-literal': false },
  loader: { '.css': 'local-css', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  plugins: [{ name: 'component-styles', setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path.startsWith('.') ? resolve(args.resolveDir, args.path) : new URL(import.meta.resolve(args.path)).pathname, sideEffects: false }))
  } }],
})
const css = client.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
const js = client.outputFiles.find(file => file.path.endsWith('.js')).text
await writeFile('dist/client.js', 'window.__ModuleLoader__.load({ id: "dsh-shared-remote", factory(require) {\nconst module = { exports: {} };\nconst __dshRemoteCss = ' + JSON.stringify(css) + ';\n' + js + '\nreturn module.exports;\n} });\n')
await Promise.all([
  build({ entryPoints: ['src/host.cjs'], outfile: 'dist/host.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', charset: 'utf8' }),
  build({ entryPoints: ['src/magpie/remote.cjs'], outfile: 'dist/magpie-agent.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', charset: 'utf8' }),
])
