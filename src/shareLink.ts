import { parseSharedBuild } from "./persistence";
import type { BaseConfig, PlacedComponent } from "./types";

/**
 * Shareable build links, with no backend: the build is serialized to JSON, compressed with the browser's
 * built-in CompressionStream, base64url-encoded and put in the URL hash (`#build=v1.<data>`). The hash never
 * reaches a server, and opening the link rebuilds the exact same building.
 */

const PREFIX = "build=";
/** Links longer than this get truncated or rejected by chat apps and some browsers. */
const MAX_HASH_LENGTH = 8000;

export class ShareLinkError extends Error {}

export interface SharedBuild {
  base: BaseConfig;
  components: PlacedComponent[];
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(stream),
  );
  return new Uint8Array(await out.arrayBuffer());
}

const hasCompression =
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined";

/** Encodes a build as the value after `#build=` (e.g. `v1.eJzL...`). Throws ShareLinkError if it can't be a link. */
export async function encodeBuild(
  base: BaseConfig,
  components: PlacedComponent[],
): Promise<string> {
  if (components.some((c) => c.modelData)) {
    throw new ShareLinkError(
      "This build contains an imported 3D model, which is too large to put in a link. Remove it to share.",
    );
  }
  const json = new TextEncoder().encode(JSON.stringify({ base, components }));
  const payload = hasCompression
    ? `v1.${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}`
    : `v0.${toBase64Url(json)}`;
  if (payload.length > MAX_HASH_LENGTH) {
    throw new ShareLinkError(
      "This build is too large to share as a link. Try a smaller layout.",
    );
  }
  return payload;
}

/** Decodes and validates the value after `#build=`. Returns null for anything malformed, truncated or from a different schema. */
export async function decodeBuild(
  payload: string,
): Promise<SharedBuild | null> {
  try {
    const dot = payload.indexOf(".");
    const version = payload.slice(0, dot);
    const bytes = fromBase64Url(payload.slice(dot + 1));
    let json: Uint8Array;
    if (version === "v1") {
      if (!hasCompression) return null;
      json = await pipe(bytes, new DecompressionStream("deflate-raw"));
    } else if (version === "v0") {
      json = bytes;
    } else {
      return null;
    }
    return parseSharedBuild(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

/** The full link for the current page, e.g. https://host/path/#build=v1.... */
export async function buildShareUrl(
  base: BaseConfig,
  components: PlacedComponent[],
): Promise<string> {
  const payload = await encodeBuild(base, components);
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `${PREFIX}${payload}`;
  return url.toString();
}

/** The build payload in a location hash, if the hash is a share link. */
export function payloadFromHash(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  return h.startsWith(PREFIX) ? h.slice(PREFIX.length) : null;
}
