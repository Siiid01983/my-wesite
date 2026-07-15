// api/upload.ts — FormDataPart-safe multipart upload for React Native / Expo.
//
// Fixes "Unsupported FormDataPart": in RN you must append a FILE OBJECT
// { uri, name, type } — NOT a Blob, base64 string, or byte array — and you must
// NOT set Content-Type yourself (the runtime adds the multipart boundary).
// Uses XMLHttpRequest because fetch() has no upload-progress in RN.
//
// Server: POST {apiBase}/storage.php?action=upload  (fields bucket, path, file)
//         header X-API-KEY ; response { data: { path } }

export type UploadAuth = { apiBase: string; apiKey: string };

export type UploadOptions = {
  localUri: string;              // expo-image-picker asset.uri (file:// | ph:// | content://)
  fileName?: string;
  mimeType?: string;             // asset.mimeType, e.g. 'image/jpeg'
  bucket?: string;               // default 'media' (publicly readable via ?action=get)
  threadId: string;             // chat thread → path namespacing
  onProgress?: (pct: number) => void;
  signal?: { aborted: boolean }; // optional cooperative cancel
};

export type UploadResult = { path: string; url: string };

// iOS Photos (ph://) and some Android content:// URIs are not directly readable
// by the multipart encoder. Copy them to a real cache file first.
async function toReadableFileUri(uri: string, fileName: string): Promise<string> {
  if (uri.startsWith('file://')) return uri;
  try {
    // Lazy require so this module has no hard dependency if you already pass file://.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require('expo-file-system');
    const dest = `${FileSystem.cacheDirectory}${Date.now()}_${fileName}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    // If expo-file-system isn't available, fall back to the original uri and let
    // the platform try — most Android file pickers already return a readable uri.
    return uri;
  }
}

export function publicMediaUrl(apiBase: string, bucket: string, path: string): string {
  return `${apiBase.replace(/\/+$/, '')}/storage.php?action=get&bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}

export async function uploadChatImage(auth: UploadAuth, opts: UploadOptions): Promise<UploadResult> {
  const {
    localUri, bucket = 'media', threadId,
    fileName = `img_${Date.now()}.jpg`,
    mimeType = 'image/jpeg',
    onProgress, signal,
  } = opts;

  const apiBase = auth.apiBase.replace(/\/+$/, '');
  const uri = await toReadableFileUri(localUri, fileName);
  const path = `chat/${threadId}/${Date.now()}_${fileName}`;

  const form = new FormData();
  form.append('bucket', bucket);
  form.append('path', path);
  // ✅ RN file part — object with uri/name/type. NOT a Blob / base64.
  form.append('file', { uri, name: fileName, type: mimeType } as any);

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/storage.php?action=upload`);
    xhr.setRequestHeader('X-API-KEY', auth.apiKey);
    // ❌ Do NOT set Content-Type — RN sets "multipart/form-data; boundary=…".

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    if (signal) {
      const iv = setInterval(() => { if (signal.aborted) { clearInterval(iv); xhr.abort(); } }, 250);
      xhr.onloadend = () => clearInterval(iv);
    }
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        const p = j?.data?.path;
        if (xhr.status >= 200 && xhr.status < 300 && p) {
          resolve({ path: p, url: publicMediaUrl(apiBase, bucket, p) });
        } else {
          reject(new Error(j?.error?.message || j?.error || `HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error(`Bad response: ${String(xhr.responseText).slice(0, 120)}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(form);
  });
}
