// Serves the website locally, for trying it and the web flasher before they're published:
//
//   node website/dev.mjs            http://localhost:8090
//   node website/dev.mjs --firmware also offers the firmware built in firmware/build as a release
//
// Web Serial needs a secure page, and http://localhost counts as one. No packages needed.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8090);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.bin': 'application/octet-stream',
};

/**
 * Offers the images in firmware/build as a release, the way a published one looks: each build in
 * firmware/builds.json that has been built, with its size and SHA-256, in website/firmware/local.
 */
function stageLocalFirmware() {
  const firmware = resolve(root, '../firmware');
  const dir = join(root, 'firmware', 'local');
  mkdirSync(dir, { recursive: true });
  const builds = [];
  let newest = 0;
  for (const build of JSON.parse(readFileSync(join(firmware, 'builds.json'), 'utf8'))) {
    const image = join(firmware, 'build', build.file);
    if (!existsSync(image)) {
      console.warn(`Skipping ${build.name}: no ${image}`);
      continue;
    }
    const bytes = readFileSync(image);
    writeFileSync(join(dir, build.file), bytes);
    builds.push({ ...build, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    newest = Math.max(newest, statSync(image).mtimeMs);
  }
  if (!builds.length) {
    console.error('No full image yet. In firmware/, run: idf.py build && idf.py merge-bin --output openrv-gateway-full.bin');
    process.exit(1);
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 'local', builds }, null, 2));
  const release = { tag: 'local', version: 'local build', published_at: new Date(newest).toISOString(), prerelease: true, dir: 'firmware/local/' };
  writeFileSync(join(root, 'firmware', 'releases.json'), JSON.stringify([release], null, 2));
  console.log(`Offering ${builds.map((b) => b.file).join(', ')} as a release.`);
}

if (process.argv.includes('--firmware')) stageLocalFirmware();

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`OpenRV website on http://localhost:${port}`));
