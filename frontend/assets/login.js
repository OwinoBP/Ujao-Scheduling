import { api, redirectToRole, setBanner } from './common.js';

const form = document.getElementById('login-form');
const statusBanner = document.getElementById('login-status');
const submitButton = form.querySelector('button[type="submit"]');

void initialize();

async function initialize() {
  try {
    const payload = await api('/me');
    redirectToRole(payload.user.role);
    return;
  } catch (error) {
    if (error.status && error.status !== 401) {
      setBanner(statusBanner, error.message, 'error');
    }
  }

  form.addEventListener('submit', handleSubmit);
}

async function handleSubmit(event) {
  event.preventDefault();
  submitButton.disabled = true;
  setBanner(statusBanner, 'Signing you in...');

  const formData = new FormData(form);

  try {
    const payload = await api('/login', {
      method: 'POST',
      body: {
        email: String(formData.get('email') || '').trim(),
        password: String(formData.get('password') || '')
      }
    });

    setBanner(statusBanner, 'Login successful. Redirecting...', 'success');
    redirectToRole(payload.user.role);
  } catch (error) {
    submitButton.disabled = false;
    setBanner(statusBanner, error.message, 'error');
  }
}

