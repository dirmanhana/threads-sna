const KEY = 'sna-project';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const DEFAULT_PROJECT = 'default';

export function normalizeProject(value) {
  const slug = String(value || '').trim();
  return SLUG_RE.test(slug) ? slug : '';
}

export function currentProject() {
  try {
    const fromUrl = normalizeProject(new URLSearchParams(globalThis.location.search).get('project'));
    if (fromUrl) {
      localStorage.setItem(KEY, fromUrl);
      return fromUrl;
    }
    const saved = normalizeProject(localStorage.getItem(KEY));
    return saved || DEFAULT_PROJECT;
  } catch {
    return DEFAULT_PROJECT;
  }
}

export function withProject(url, project = currentProject()) {
  try {
    const u = new URL(url, globalThis.location.origin);
    u.searchParams.set('project', project);
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

export function projectFile(name, project = currentProject()) {
  return `/projects/${encodeURIComponent(project)}/${name}`;
}

export function switchProject(slug) {
  const project = normalizeProject(slug) || DEFAULT_PROJECT;
  try {
    localStorage.setItem(KEY, project);
    const u = new URL(globalThis.location.href);
    u.searchParams.set('project', project);
    globalThis.location.href = u.pathname + u.search + u.hash;
  } catch {
    globalThis.location.href = `/scrape.html?project=${encodeURIComponent(project)}`;
  }
}
