import {
  api,
  buildQuery,
  escapeHtml,
  formatDateTime,
  logout,
  requireUser,
  setBanner,
  todayInBrowser
} from './common.js';

const greeting = document.getElementById('driver-greeting');
const meta = document.getElementById('driver-meta');
const dateInput = document.getElementById('driver-date');
const refreshButton = document.getElementById('driver-refresh');
const logoutButton = document.getElementById('driver-logout');
const statusBanner = document.getElementById('driver-status');
const groups = document.getElementById('driver-groups');
const lastSync = document.getElementById('driver-last-sync');
const connection = document.getElementById('driver-connection');

const state = {
  user: null,
  date: todayInBrowser(),
  buses: [],
  openIncidentStudentId: null,
  busyTripLogIds: new Set(),
  lastLoadedAt: null
};

void initialize();

async function initialize() {
  try {
    state.user = await requireUser('Driver');
  } catch {
    return;
  }

  dateInput.value = state.date;
  refreshButton.addEventListener('click', () => {
    void loadDriverData('Route refreshed.');
  });
  logoutButton.addEventListener('click', () => {
    void logout();
  });
  dateInput.addEventListener('change', () => {
    state.date = dateInput.value || todayInBrowser();
    void loadDriverData();
  });
  groups.addEventListener('click', handleGroupClick);
  groups.addEventListener('submit', handleGroupSubmit);
  window.addEventListener('online', renderConnectionState);
  window.addEventListener('offline', renderConnectionState);

  await loadDriverData();
}

async function loadDriverData(successMessage) {
  setBanner(statusBanner, 'Loading your route...');

  try {
    const payload = await api(`/driver/triplogs${buildQuery({ date: state.date })}`);
    state.user = payload.user;
    state.buses = payload.buses || [];
    state.date = payload.date;
    state.lastLoadedAt = new Date();
    dateInput.value = state.date;
    render();
    renderConnectionState();
    setBanner(statusBanner, successMessage || '');
  } catch (error) {
    setBanner(statusBanner, error.message, 'error');
  }
}

function render() {
  greeting.textContent = state.user?.name ? `${state.user.name}'s route` : 'Today’s route';
  meta.textContent = `${state.user?.email || ''} • ${state.buses.length} bus groups`;
  lastSync.textContent = state.lastLoadedAt
    ? `Last synced ${new Intl.DateTimeFormat('en-KE', {
        hour: 'numeric',
        minute: '2-digit'
      }).format(state.lastLoadedAt)}`
    : 'Waiting for data';

  if (state.buses.length === 0) {
    groups.innerHTML =
      '<div class="empty-state">No assigned buses were found for this driver.</div>';
    return;
  }

  groups.innerHTML = state.buses
    .map(
      (bus) => `
        <section class="route-card">
          <div class="route-header">
            <div>
              <h2>${escapeHtml(bus.plateNumber || 'Bus')}</h2>
              <p class="muted">${escapeHtml(bus.routeName || 'Route not set')}</p>
            </div>
            <span class="chip">${bus.students.length} students</span>
          </div>
          <div class="stack">
            ${
              bus.students.length > 0
                ? bus.students.map((student) => renderStudentCard(student)).join('')
                : '<div class="empty-state">No students are assigned to this bus yet.</div>'
            }
          </div>
        </section>
      `
    )
    .join('');
}

function renderStudentCard(student) {
  const tripLog = student.tripLog;
  const amStamp = tripLog?.amTimestamp ? formatDateTime(tripLog.amTimestamp) : 'Not yet marked';
  const pmStamp = tripLog?.pmTimestamp ? formatDateTime(tripLog.pmTimestamp) : 'Not yet marked';
  const incidentOpen = state.openIncidentStudentId === student.id;

  return `
    <article class="student-card">
      <div class="route-header">
        <div>
          <h3>${escapeHtml(student.name)}</h3>
          <div class="record-meta">
            <span>Guardian: ${escapeHtml(student.guardianName || 'Not set')}</span>
            <span>${escapeHtml(student.guardianPhone || 'No guardian phone')}</span>
          </div>
        </div>
        <button class="ghost-button mini-button" data-action="toggle-incident" data-student-id="${escapeHtml(student.id)}" type="button">
          ${incidentOpen ? 'Close form' : 'Report incident'}
        </button>
      </div>

      <div class="address-block">
        <div>
          <strong>Pickup</strong>
          <div class="muted">${escapeHtml(student.pickupAddress || 'Not set')}</div>
        </div>
        <div>
          <strong>Dropoff</strong>
          <div class="muted">${escapeHtml(student.dropoffAddress || 'Not set')}</div>
        </div>
      </div>

      <div class="status-strip">
        <div class="status-row">
          <div class="status-row-label">
            <strong>Morning</strong>
            <span>${escapeHtml(`${tripLog?.amStatus || 'Pending'} • ${amStamp}`)}</span>
          </div>
          <div class="status-button-row">
            ${renderStatusButton(tripLog, 'AM', 'PickedUp', 'Picked up')}
            ${renderStatusButton(tripLog, 'AM', 'Absent', 'Absent')}
          </div>
        </div>

        <div class="status-row">
          <div class="status-row-label">
            <strong>Afternoon</strong>
            <span>${escapeHtml(`${tripLog?.pmStatus || 'Pending'} • ${pmStamp}`)}</span>
          </div>
          <div class="status-button-row">
            ${renderStatusButton(tripLog, 'PM', 'DroppedOff', 'Dropped off')}
            ${renderStatusButton(tripLog, 'PM', 'Absent', 'Absent')}
          </div>
        </div>
      </div>

      ${
        incidentOpen
          ? `
            <form class="incident-form" data-student-id="${escapeHtml(student.id)}">
              <label class="field-group">
                <span>Severity</span>
                <select name="severity" required>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </label>
              <label class="field-group">
                <span>Description</span>
                <textarea name="description" placeholder="Describe what happened" required></textarea>
              </label>
              <div class="inline-actions">
                <button class="secondary-button" type="submit">Send incident</button>
                <button class="ghost-button" data-action="close-incident" data-student-id="${escapeHtml(student.id)}" type="button">
                  Cancel
                </button>
              </div>
            </form>
          `
          : ''
      }
    </article>
  `;
}

function renderStatusButton(tripLog, period, status, label) {
  const currentStatus = period === 'AM' ? tripLog?.amStatus : tripLog?.pmStatus;
  const isActive = currentStatus === status;
  const isAbsent = status === 'Absent';
  const isBusy = tripLog ? state.busyTripLogIds.has(tripLog.id) : false;

  return `
    <button
      class="status-button ${isActive ? (isAbsent ? 'is-muted-active' : 'is-active') : ''}"
      data-action="mark-status"
      data-triplog-id="${escapeHtml(tripLog?.id || '')}"
      data-period="${escapeHtml(period)}"
      data-status="${escapeHtml(status)}"
      type="button"
      ${tripLog ? '' : 'disabled'}
      ${isBusy ? 'disabled' : ''}
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderConnectionState() {
  const online = navigator.onLine;
  connection.textContent = online ? 'Online' : 'Offline';
  connection.className = `chip ${online ? '' : 'chip-muted'}`.trim();
}

async function handleGroupClick(event) {
  const actionTarget = event.target.closest('[data-action]');

  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;

  if (action === 'toggle-incident') {
    state.openIncidentStudentId =
      state.openIncidentStudentId === actionTarget.dataset.studentId
        ? null
        : actionTarget.dataset.studentId;
    render();
    return;
  }

  if (action === 'close-incident') {
    state.openIncidentStudentId = null;
    render();
    return;
  }

  if (action === 'mark-status') {
    const { triplogId, period, status } = actionTarget.dataset;

    if (!triplogId) {
      return;
    }

    await updateTripLog(triplogId, period, status);
  }
}

async function handleGroupSubmit(event) {
  const form = event.target;

  if (!form.classList.contains('incident-form')) {
    return;
  }

  event.preventDefault();
  const studentId = form.dataset.studentId;
  const formData = new FormData(form);

  try {
    await api('/driver/incidents', {
      method: 'POST',
      body: {
        studentId,
        severity: String(formData.get('severity') || 'Low'),
        description: String(formData.get('description') || '').trim()
      }
    });

    state.openIncidentStudentId = null;
    setBanner(statusBanner, 'Incident logged successfully.', 'success');
    render();
  } catch (error) {
    setBanner(statusBanner, error.message, 'error');
  }
}

async function updateTripLog(tripLogId, period, status) {
  state.busyTripLogIds.add(tripLogId);
  render();

  try {
    const payload = await api(`/driver/triplogs/${tripLogId}`, {
      method: 'PATCH',
      body: { period, status }
    });

    for (const bus of state.buses) {
      for (const student of bus.students) {
        if (student.tripLog?.id === tripLogId) {
          student.tripLog = payload.tripLog;
        }
      }
    }

    state.lastLoadedAt = new Date();
    setBanner(statusBanner, 'Trip log updated.', 'success');
  } catch (error) {
    setBanner(statusBanner, error.message, 'error');
  } finally {
    state.busyTripLogIds.delete(tripLogId);
    render();
  }
}

