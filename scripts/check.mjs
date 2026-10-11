import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = await readdir('js');
for (const file of files.filter(name => name.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', `js/${file}`], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
const html = await readFile('index.html', 'utf8');
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)) await readFile(match[1]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML IDs');
const app = await readFile('js/app.js', 'utf8');
for (const match of app.matchAll(/\$\('([^']+)'\)/g)) if (!ids.includes(match[1])) throw new Error('Missing HTML control: ' + match[1]);
console.log('JavaScript syntax, local assets and application control IDs passed.');
