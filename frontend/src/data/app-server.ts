import { supabase } from './supabase';

// The app server (worker/server.ts) hosts the HyperFrames editor. The editor loads in an iframe,
// which can't send a bearer token, so the server keeps the Supabase access token in a cookie.
export async function syncSession() {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  if (!data.session) throw new Error('Sign in again to open the editor.');
  const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: data.session.access_token }) });
  if (!res.ok) throw new Error('The editor server is not reachable. Please try again in a moment.');
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? 'Something went wrong. Please try again.');
  return body as T;
}

// A large file to the app server, reporting progress (fetch can't report upload progress).
export function uploadFile(path: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', path);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status < 300) return resolve();
      let message = 'The upload failed. Please try again.';
      try { message = JSON.parse(xhr.responseText).error ?? message; } catch { /* keep the default */ }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.send(file);
  });
}

// A file name the server accepts (letters, digits, spaces, . ( ) -), keeping the extension.
export const safeName = (name: string, fallback: string) => name.replace(/[^\w .()-]/g, '_').slice(-120).replace(/^[^\w]+/, '') || fallback;
