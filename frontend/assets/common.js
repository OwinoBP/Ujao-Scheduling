const API_BASE_URL = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/$/, '');

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const init = {
    method: options.method || 'GET',
    credentials: 'include',
    headers
  };

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE_URL}/api${path}`, init);

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error = new Error(
      payload?.error || payload?.message || response.statusText || 'Request failed.'
    );

    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function buildQuery(params) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, value);
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDateOnly(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-KE', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
}

export function todayInBrowser() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function redirectToRole(role) {
  window.location.replace(role === 'Admin' ? 'admin.html' : 'driver.html');
}

export async function requireUser(expectedRole) {
  try {
    const payload = await api('/me');
    const { user } = payload;

    if (expectedRole && user.role !== expectedRole) {
      redirectToRole(user.role);
      throw new Error('Redirecting to the correct workspace.');
    }

    return user;
  } catch (error) {
    if (error.status === 401) {
      window.location.replace('login.html');
    }

    throw error;
  }
}

export async function logout() {
  try {
    await api('/logout', { method: 'POST' });
  } catch {
    // Best-effort cookie clearing.
  }

  window.location.replace('login.html');
}

export function setBanner(element, message, tone = 'info') {
  if (!element) {
    return;
  }

  if (!message) {
    element.hidden = true;
    element.textContent = '';
    element.className = 'status-banner';
    return;
  }

  element.hidden = false;
  element.textContent = message;
  element.className = 'status-banner';

  if (tone === 'error') {
    element.classList.add('is-error');
  }

  if (tone === 'success') {
    element.classList.add('is-success');
  }
}

