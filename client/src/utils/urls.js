export function getAppUrl(path = '/', params = {}) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin).toString().replace(/\/$/, '');
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ).toString();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}/#${normalizedPath}${query ? `?${query}` : ''}`;
}
