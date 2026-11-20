import { api } from './api';

/* Minimal typing for the parts of Google Picker we use. */
interface PickerDoc {
  id: string;
  resourceKey?: string;
}
interface GooglePickerNS {
  ViewId: { FOLDERS: string };
  Action: { PICKED: string; CANCEL: string };
  DocsView: new (viewId: string) => {
    setSelectFolderEnabled(v: boolean): unknown;
    setMimeTypes(m: string): unknown;
    setIncludeFolders(v: boolean): unknown;
  };
  PickerBuilder: new () => PickerBuilder;
}
interface PickerBuilder {
  addView(v: unknown): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  setOrigin(o: string): PickerBuilder;
  setCallback(cb: (d: { action: string; docs?: PickerDoc[] }) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
declare global {
  interface Window {
    gapi?: { load(name: string, cb: () => void): void };
    google?: { picker: GooglePickerNS };
  }
}

let loader: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.onload = () => window.gapi!.load('picker', () => resolve());
    s.onerror = () => reject(new Error('Couldn’t load Google Picker.'));
    document.head.appendChild(s);
  });
  return loader;
}

/** Opens Google Picker restricted to folders. Owner-only: the short-lived token comes from an admin endpoint. */
export async function openDrivePicker(): Promise<{ id: string; resourceKey: string | null } | null> {
  const cfg = await api<{ apiKey: string; appId: string | null; token: string }>('/api/admin/drive/picker');
  await loadPicker();
  const P = window.google!.picker;
  return new Promise((resolve) => {
    const view = new P.DocsView(P.ViewId.FOLDERS);
    view.setSelectFolderEnabled(true);
    view.setIncludeFolders(true);
    view.setMimeTypes('application/vnd.google-apps.folder');
    let b = new P.PickerBuilder()
      .addView(view)
      .setOAuthToken(cfg.token)
      .setDeveloperKey(cfg.apiKey)
      .setOrigin(location.origin)
      .setTitle('Choose the folder that holds the photographs')
      .setCallback((d) => {
        if (d.action === P.Action.PICKED && d.docs?.[0])
          resolve({ id: d.docs[0].id, resourceKey: d.docs[0].resourceKey ?? null });
        else if (d.action === P.Action.CANCEL) resolve(null);
      });
    if (cfg.appId) b = b.setAppId(cfg.appId);
    b.build().setVisible(true);
  });
}
