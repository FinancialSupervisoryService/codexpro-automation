import { createHash } from 'node:crypto';
import { readFile, realpath, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
export async function applyPowerPicker(packageRoot) {
  const root = await realpath(packageRoot);
  const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
  const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  if (version !== '0.18.0') throw new Error('Power picker patch requires Oracle 0.18.0.');
  const changes = [];
  for (const entry of manifest.files) {
    const target = resolve(root, entry.path);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid patch target.');
    const parent = await realpath(dirname(target));
    if (parent !== dirname(target)) throw new Error('Patch parent must not contain symlinks.');
    let original = null;
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Unsafe patch target.');
      original = await readFile(target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (original && sha(original) === entry.patched) continue;
    if ((original ? sha(original) : null) !== entry.pristine) throw new Error(`Unrecognized Oracle bytes: ${entry.path}`);
    let next;
    if (entry.source) next = await readFile(join(here, entry.source));
    else {
      let text = original.toString('utf8');
      for (const replacement of entry.replacements) {
        if (text.split(replacement.before).length !== 2) throw new Error(`Patch match is not unique: ${entry.path}`);
        text = text.replace(replacement.before, replacement.after);
      }
      next = Buffer.from(text, 'utf8');
    }
    if (sha(next) !== entry.patched) throw new Error(`Patched bytes mismatch: ${entry.path}`);
    changes.push({ target, next });
  }
  // Validate every file before writing any. Installation happens only in a new image/stage.
  for (const { target, next } of changes) {
    const tmp = `${target}.power-picker-${process.pid}.tmp`;
    try {
      await writeFile(tmp, next, { flag: 'wx', mode: 0o644 });
      await rename(tmp, target);
    } finally { await rm(tmp, { force: true }); }
  }
  return { changed: changes.length, version };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await applyPowerPicker(process.argv[2])));
}
