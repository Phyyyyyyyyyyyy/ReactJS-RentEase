/**
 * Small fetch wrapper for the Django API at /api.
 *
 * Sign-in uses Django's session cookie. Django also sets a `csrftoken` cookie
 * (GET /api/auth/session/), which is sent back in the X-CSRFToken header on
 * every request that changes data.
 */

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || data?.detail || defaultMessage(status));
    this.status = status;
    this.data = data || {};
  }
}

function defaultMessage(status) {
  if (status === 404) return 'That page could not be found.';
  if (status === 403) return 'You do not have permission to open that page.';
  if (status >= 500) return 'Something went wrong on the server. Please try again.';
  if (status === 0) return 'Could not reach the server. Check that the backend is running.';
  return 'Something went wrong. Please try again.';
}

function getCookie(name) {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : '';
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  let payload;
  if (body instanceof FormData) {
    payload = body; // the browser sets the multipart Content-Type with its boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') headers['X-CSRFToken'] = getCookie('csrftoken');

  let response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, null);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // empty or non-JSON body
  }
  if (response.status === 401) window.dispatchEvent(new Event('rentease:signed-out'));
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

/** Build a FormData from plain values (skips null/undefined). Files are passed through. */
export function toFormData(values) {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'boolean') {
      if (value) form.append(key, 'on');
      return;
    }
    form.append(key, value);
  });
  return form;
}
