// Địa chỉ công khai của app, dùng cho link trong email xác minh.
// Ưu tiên VITE_PUBLIC_SITE_URL để link không bao giờ trỏ về localhost khi
// đăng ký từ máy dev; nếu không cấu hình thì lấy origin hiện tại.
export function getPublicBaseUrl() {
  const configured = import.meta.env.VITE_PUBLIC_SITE_URL;
  if (configured) return `${configured.replace(/\/+$/, '')}/`;
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

export function getAppUrl(path = '/', params = {}) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin).toString().replace(/\/$/, '');
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ).toString();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}/#${normalizedPath}${query ? `?${query}` : ''}`;
}
