import { build } from 'esbuild';
import { mkdir, readFile, copyFile } from 'node:fs/promises';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const assets = {};
for (const filename of ['index.html', 'styles.css', 'app.js', 'status.html', 'status.js']) {
  const extension = filename.slice(filename.lastIndexOf('.'));
  assets[`/${filename}`] = { body: await readFile(`public/${filename}`, 'utf8'), type: types[extension] };
}
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await build({ entryPoints: ['src/cloud-worker.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js', define: { __STATIC_ASSETS__: JSON.stringify(assets) } });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Worker e interface preparados em dist/server/index.js');
