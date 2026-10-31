import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'ui', 'dist');
const shared = await build({
  absWorkingDir: root,
  entryPoints: ['shared/protocol.ts', 'shared/office-contract.ts'],
  outdir: 'server/dist',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const result = await build({
  absWorkingDir: root,
  entryPoints: ['ui/src/main.ts', 'ui/styles.css'],
  outdir: 'ui/dist/assets',
  entryNames: '[name]-[hash]',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  metafile: true,
  write: false,
});
const outputs = Object.keys(result.metafile.outputs);
const js = outputs.find(p => p.endsWith('.js'));
const css = outputs.find(p => p.endsWith('.css'));
if (!js || !css) throw new Error('Frontend build did not produce both JavaScript and CSS.');
const html = readFileSync(join(root, 'ui/index.html'), 'utf8')
  .replace('APP_SCRIPT', `/${js.replace('ui/dist/', '')}`)
  .replace('APP_STYLES', `/${css.replace('ui/dist/', '')}`);
mkdirSync(join(dist, 'assets'), { recursive: true });
for (const file of shared.outputFiles) {
  if (!existsSync(file.path) || !readFileSync(file.path).equals(file.contents)) writeFileSync(file.path, file.contents);
}
for (const file of result.outputFiles) writeFileSync(file.path, file.contents);
copyFileSync(join(root, 'ui/logo.svg'), join(dist, 'logo.svg'));
writeFileSync(join(dist, 'index.html'), html);
// Keep the previous page usable until its replacement and all assets exist.
const generated = new Set(result.outputFiles.map(file => basename(file.path)));
for (const file of readdirSync(join(dist, 'assets'))) {
  if (!generated.has(file)) rmSync(join(dist, 'assets', file));
}
console.log(`Built ${js} and ${css}`);
