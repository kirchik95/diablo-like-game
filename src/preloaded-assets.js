// Retain the splash's encoded PNG/JSON downloads until the renderer consumes them. Decode PNGs only
// in Babylon's normal asynchronous loader: eager decoding retained 82 MiB of pixels without a CPU win.
const textures = new Map(), responses = new Map();

export async function retainPreloadedAsset(url, blob, { urls = globalThis.URL } = {}) {
  if (/\.json(?:[?#]|$)/.test(url)) { responses.set(url, blob); return; }
  const source = urls.createObjectURL(blob);
  let released = false;
  textures.set(url, { url: source, release() {
    if (!released) { released = true; urls.revokeObjectURL(source); }
  } });
}

export function takePreloadedTexture(url) {
  const entry = textures.get(url);
  textures.delete(url);
  return entry;
}

export function takePreloadedResponse(url) {
  const blob = responses.get(url);
  responses.delete(url);
  return blob ? new Response(blob) : undefined;
}

// A failed boot never constructs the renderer, so release files it would otherwise have consumed.
export function clearPreloadedAssets() {
  for (const entry of textures.values()) entry.release();
  textures.clear(); responses.clear();
}
