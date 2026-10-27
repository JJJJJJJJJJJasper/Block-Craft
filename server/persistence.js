// ============================================================================
// Saving and loading worlds as JSON files in the data folder.
//
// Files are written to a temporary name first and then renamed over the old
// file. A rename is atomic, so a crash mid-save can never leave a
// half-written (corrupt) world file behind.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidRoomCode } from '../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

function fileFor(code) {
  if (!isValidRoomCode(code)) throw new Error('bad room code');
  return path.join(DATA_DIR, `${code}.json`);
}

export function worldExists(code) {
  return isValidRoomCode(code) && fs.existsSync(fileFor(code));
}

export function loadWorld(code) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(code), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[save] failed to load ${code}:`, e.message);
    return null;
  }
}

export async function saveWorld(code, data) {
  const file = fileFor(code);
  const tmp = file + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(data));
  await fs.promises.rename(tmp, file);
}

export function saveWorldSync(code, data) {
  const file = fileFor(code);
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
}
