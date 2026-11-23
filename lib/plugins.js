import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = path.resolve(process.env.ESPMS_PLUGIN_DIR || path.join(process.cwd(), 'plugins'));
const installed = new Map();
const failures = [];
const clean = (value, limit = 160) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, limit);
const validId = value => /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);

export async function load() {
  fs.mkdirSync(directory, { recursive: true });
  installed.clear();
  failures.length = 0;
  for (const file of fs.readdirSync(directory).filter(name => /^[a-z0-9][a-z0-9-]*\.js$/.test(name)).sort()) {
    try {
      const filePath = path.join(directory, file);
      const moduleUrl = pathToFileURL(filePath);
      moduleUrl.searchParams.set('v', String(fs.statSync(filePath).mtimeMs));
      const plugin = (await import(moduleUrl.href)).default;
      if (!plugin || typeof plugin.id !== 'string' || !validId(plugin.id) || typeof plugin.name !== 'string' || !plugin.name.trim() ||
          typeof plugin.search !== 'function' || typeof plugin.resolve !== 'function')
        throw new Error('Expected a default export with id, name, search(query), and resolve(itemId)');
      if (installed.has(plugin.id)) throw new Error(`Duplicate plugin id "${plugin.id}"`);
      installed.set(plugin.id, plugin);
    } catch (error) {
      const message = `${file}: ${error.message || 'Could not load plugin'}`;
      failures.push(message);
      console.error(`ESP Music Server plugin: ${message}`);
    }
  }
}

export function list() {
  return {
    plugins: [...installed.values()].map(({ id, name, version, description }) => ({
      id, name: clean(name, 80), version: clean(version || '0.0.0', 40), description: clean(description, 300),
    })),
    errors: [...failures],
  };
}

export async function search(id, query) {
  const plugin = installed.get(id);
  if (!plugin) throw new Error('No such plugin');
  const items = await plugin.search(clean(query, 200));
  if (!Array.isArray(items)) throw new Error(`Plugin "${plugin.name}" returned an invalid search result`);
  return items.slice(0, 100).map(item => {
    if (!item || item.id == null || !clean(item.title, 160)) throw new Error(`Plugin "${plugin.name}" returned an invalid item`);
    return {
      id: clean(item.id, 200), title: clean(item.title, 160), artist: clean(item.artist, 160),
      album: clean(item.album, 160), duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : 0,
    };
  });
}

export async function resolve(id, itemId) {
  const plugin = installed.get(id);
  if (!plugin) throw new Error('No such plugin');
  const result = await plugin.resolve(clean(itemId, 200));
  let url;
  try { url = new URL(String(result?.url || '')); } catch { throw new Error(`Plugin "${plugin.name}" returned an invalid stream URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new Error(`Plugin "${plugin.name}" must return an HTTP or HTTPS stream URL without credentials`);
  return { url: url.href, title: clean(result.title), artist: clean(result.artist) };
}
