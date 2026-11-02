// Gateway firmware: find the newest release on GitHub, keep one verified copy on the phone (the RV
// has no internet), and install it over the gateway's own Wi-Fi (fast) or over Bluetooth (works
// wherever the app is connected, in a minute or two).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { GatewayWifi } from '../../modules/gateway-wifi';
import type { Op } from '@/protocol/types';

const REPO = 'openrvapp/openrv';
const TAG_PREFIX = 'firmware-v';
const IMAGE_ASSET = 'openrv-gateway.bin';
const MANIFEST_ASSET = 'manifest.json';
const TOKEN_KEY = 'github_token';

export interface Manifest {
  version: string;
  sha256: string;
  size: number;
}

export interface Release {
  version: string;
  notes: string;
  imageUrl: string; // GitHub API asset URLs (work for private repos with a token)
  manifestUrl: string;
}

export const getGitHubToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const setGitHubToken = (token: string | null) =>
  token ? SecureStore.setItemAsync(TOKEN_KEY, token.trim()) : SecureStore.deleteItemAsync(TOKEN_KEY);

/** Compares dotted versions: negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

async function headers(accept: string): Promise<Record<string, string>> {
  const token = await getGitHubToken();
  return {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** The newest firmware release, or null when there is none. */
export async function latestRelease(): Promise<Release | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: await headers('application/vnd.github+json'),
  });
  if (res.status === 401 || res.status === 404) throw new Error('GitHub refused: check the access token in Settings.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const releases = (await res.json()) as {
    tag_name: string;
    draft: boolean;
    body: string | null;
    assets: { name: string; url: string }[];
  }[];
  const candidates = releases
    .filter((r) => !r.draft && r.tag_name.startsWith(TAG_PREFIX))
    .map((r) => ({
      version: r.tag_name.slice(TAG_PREFIX.length),
      notes: r.body ?? '',
      imageUrl: r.assets.find((a) => a.name === IMAGE_ASSET)?.url ?? '',
      manifestUrl: r.assets.find((a) => a.name === MANIFEST_ASSET)?.url ?? '',
    }))
    .filter((r) => r.imageUrl && r.manifestUrl)
    .sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0] ?? null;
}

function firmwareDir(): Directory {
  const dir = new Directory(Paths.document, 'firmware');
  if (!dir.exists) dir.create();
  return dir;
}

/** The image kept on the phone, if any: newest version first. */
export function downloadedImage(): Image | null {
  const images = firmwareDir()
    .list()
    .filter((e): e is File => e instanceof File && e.name.endsWith('.bin'))
    .map((file) => ({ version: file.name.replace(/\.bin$/, ''), file }))
    .sort((a, b) => compareVersions(b.version, a.version));
  return images[0] ?? null;
}

/**
 * The version inside an ESP32 app image: its app description follows the 24-byte image header and
 * the first 8-byte segment header, and starts with magic 0xABCD5432. Null if it isn't such an image.
 */
export function imageVersion(bytes: Uint8Array): string | null {
  const DESC = 32;
  if (bytes.length < DESC + 48 || bytes[0] !== 0xe9) return null;
  const magic = bytes[DESC] | (bytes[DESC + 1] << 8) | (bytes[DESC + 2] << 16) | (bytes[DESC + 3] << 24);
  if (magic >>> 0 !== 0xabcd5432) return null;
  const raw = bytes.subarray(DESC + 16, DESC + 48);
  const end = raw.indexOf(0);
  return new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end)) || null;
}

export interface Image {
  version: string;
  file: File;
}

/** Keeps `image` as the only firmware on the phone, named by its version. */
function keepOnly(dir: Directory, image: File, version: string): Image {
  for (const e of dir.list()) if (e instanceof File && e.name.endsWith('.bin') && e.uri !== image.uri) e.delete();
  const target = new File(dir, `${version}.bin`);
  if (target.exists) target.delete();
  image.move(target);
  return { version, file: target };
}

/** Lets the user pick a firmware file already on the phone (for example, one built at home). */
export async function importFromFile(): Promise<Image | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: 'application/octet-stream',
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return null;
  const source = new File(picked.assets[0].uri);
  const version = imageVersion(await source.bytes());
  if (!version) throw new Error('That file isn’t gateway firmware.');
  const dir = firmwareDir();
  const copy = new File(dir, `${version}.bin.part`);
  if (copy.exists) copy.delete();
  source.copy(copy);
  return keepOnly(dir, copy, version);
}

/** Downloads and verifies a release, then keeps it as the only image on the phone. */
export async function download(release: Release): Promise<Image> {
  const manifestRes = await fetch(release.manifestUrl, { headers: await headers('application/octet-stream') });
  if (!manifestRes.ok) throw new Error(`Couldn't get the release manifest (${manifestRes.status})`);
  const manifest = (await manifestRes.json()) as Manifest;

  const dir = firmwareDir();
  const partial = new File(dir, `${manifest.version}.bin.part`);
  if (partial.exists) partial.delete();
  await File.downloadFileAsync(release.imageUrl, partial, { headers: await headers('application/octet-stream') });

  const bytes = await partial.bytes();
  if (bytes.length !== manifest.size || bytesToHex(sha256(bytes)) !== manifest.sha256.toLowerCase()) {
    partial.delete();
    throw new Error('The download was damaged (size or checksum mismatch). Try again.');
  }
  return keepOnly(dir, partial, manifest.version);
}

export type InstallStep = 'opening' | 'joining' | 'uploading' | 'sending' | 'checking' | 'restarting';

/** Whether this phone can install over the gateway's Wi-Fi (it needs to join that network itself). */
export const WIFI_INSTALL_AVAILABLE = GatewayWifi !== null;

/** A gateway request, as the gateway store makes them. */
export type Request = <T = unknown>(op: Op, args?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;

/** How many pieces may be on their way at once: enough to keep the link busy. */
const IN_FLIGHT = 4;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64[n & 63] : '=';
  }
  return out;
}

/**
 * Installs an image over Bluetooth: sends it to the gateway in pieces over the connection the app
 * already has (ota.send.*). The gateway checks the image, switches to it and restarts; if the new
 * firmware fails to start, it goes back to the old one.
 */
export async function installOverBluetooth(
  file: File,
  request: Request,
  onStep: (step: InstallStep) => void,
  onProgress: (fraction: number) => void,
): Promise<void> {
  if (!file.exists) throw new Error('The firmware file is missing from this phone. Download or pick it again.');
  const bytes = await file.bytes();
  onStep('sending');
  const { chunk } = await request<{ chunk: number }>('ota.send.begin', { size: bytes.length }, 30_000);
  try {
    const pending: Promise<unknown>[] = [];
    for (let at = 0; at < bytes.length; at += chunk) {
      const piece = bytes.subarray(at, Math.min(at + chunk, bytes.length));
      pending.push(request('ota.send.data', { offset: at, data: toBase64(piece) }, 30_000));
      if (pending.length >= IN_FLIGHT) await pending.shift();
      onProgress(Math.min(at + chunk, bytes.length) / bytes.length);
    }
    await Promise.all(pending);
    onStep('checking');
    await request('ota.send.end', undefined, 60_000);
  } catch (e) {
    await request('ota.send.abort').catch(() => undefined);
    throw e;
  }
  onStep('restarting');
}

/**
 * Installs an image: the gateway opens its Wi-Fi (`openWindow` does ota.begin over Bluetooth), the
 * phone joins it just for this upload, POSTs the image, and the gateway restarts into it.
 */
export async function install(
  file: File,
  openWindow: () => Promise<{ ssid: string; password: string; url: string; token: string }>,
  onStep: (step: InstallStep) => void,
): Promise<void> {
  if (!GatewayWifi) throw new Error('This phone can’t join the gateway’s Wi-Fi from the app.');
  if (!file.exists) throw new Error('The firmware file is missing from this phone. Download or pick it again.');
  onStep('opening');
  const w = await openWindow();
  onStep('joining');
  try {
    await GatewayWifi.join(w.ssid, w.password, 60_000);
    onStep('uploading');
    const status = await GatewayWifi.upload(w.url, w.token, file.uri);
    if (status !== 200)
      throw new Error(status === 400 ? 'The gateway rejected the image.' : `Upload failed (${status})`);
    onStep('restarting');
  } finally {
    await GatewayWifi.release();
  }
}
