import {
  api,
  buildQuery,
  escapeHtml,
  formatDateOnly,
  formatDateTime,
  logout,
  requireUser,
  setBanner,
  todayInBrowser
} from './common.js';

const userMeta = document.getElementById('admin-user-meta');
const statusBanner = document.getElementById('admin-status');
const panel = document.getElementById('admin-panel');
const refreshButton = document.getElementById('admin-refresh');
const logoutButton = document.getElementById('admin-logout');
const navButtons = [...document.querySelectorAll('.nav-button')];

const state = {
  user: null,
  activeTab: 'schools',
  editing: {
    entity: 'schools',
    recordId: null
  },
  filters: {
    triplogs: {
      date: todayInBrowser(),
      busId: '',
      schoolId: ''
    },
    incidents: {
      date: todayInBrowser(),
      busId: '',
      schoolId: ''
    }
  },
  data: {
    schools: [],
    buses: [],
    staff: [],
    students: [],
    triplogs: [],
    incidents: []
  }
};

const ENTITY_CONFIG = {
  schools: {
    label: 'Schools',
    singular: 'school',
    endpoint: '/schools',
    summaryLabel: 'Registered schools',
    intro:
      'Capture the schools you serve so students and reporting can be linked cleanly.',
    fields: [
      { name: 'Name', label: 'School name', type: 'text', required: true },
      { name: 'Address', label: 'Address', type: 'text' },
      { name: 'ContactPerson', label: 'Contact person', type: 'text' },
      { name: 'Phone', label: 'Phone', type: 'tel' }
    ],
    columns: [
      { label: 'Name', render: (record) => escapeHtml(record.fields.Name || '—') },
      { label: 'Address', render: (record) => escapeHtml(record.fields.Address || '—') },
      {
        label: 'Contact',
        render: (record) => escapeHtml(record.fields.ContactPerson || '—')
      },
      { label: 'Phone', render: (record) => escapeHtml(record.fields.Phone || '—') }
    ]
  },
  buses: {
    label: 'Buses',
    singular: 'bus',
    endpoint: '/buses',
    summaryLabel: 'Fleet entries',
    intro:
      'Track bus availability and the route label drivers will recognize in the field.',
    fields: [
      { name: 'PlateNumber', label: 'Plate number', type: 'text', required: true },
      { name: 'Capacity', label: 'Capacity', type: 'number' },
      {
        name: 'Status',
        label: 'Status',
        type: 'select',
        options: [
          { value: 'Active', label: 'Active' },
          { value: 'Maintenance', label: 'Maintenance' },
          { value: 'Inactive', label: 'Inactive' }
        ]
      },
      { name: 'RouteName', label: 'Route name', type: 'text' }
    ],
    columns: [
      {
        label: 'Plate',
        render: (record) => escapeHtml(record.fields.PlateNumber || '—')
      },
      {
        label: 'Route',
        render: (record) => escapeHtml(record.fields.RouteName || '—')
      },
      {
        label: 'Capacity',
        render: (record) =>
          record.fields.Capacity !== undefined && record.fields.Capacity !== null
            ? escapeHtml(record.fields.Capacity)
            : '—'
      },
      { label: 'Status', render: (record) => escapeHtml(record.fields.Status || '—') }
    ]
  },
  staff: {
    label: 'Staff',
    singular: 'staff member',
    endpoint: '/staff',
    summaryLabel: 'Staff records',
    intro:
      'Admins and drivers live here for operations data. Login passwords are provisioned separately in KV.',
    note:
      'After creating a driver or admin here, add their credential to Cloudflare KV before they can sign in.',
    fields: [
      { name: 'Name', label: 'Name', type: 'text', required: true },
      {
        name: 'Role',
        label: 'Role',
        type: 'select',
        required: true,
        options: [
          { value: 'Admin', label: 'Admin' },
          { value: 'Driver', label: 'Driver' }
        ]
      },
      { name: 'Phone', label: 'Phone', type: 'tel' },
      { name: 'Email', label: 'Email', type: 'email', required: true },
      {
        name: 'AssignedBuses',
        label: 'Assigned buses',
        type: 'link-multi',
        options: () =>
          state.data.buses.map((record) => ({
            value: record.id,
            label: formatBusLabel(record)
          }))
      }
    ],
    columns: [
      { label: 'Name', render: (record) => escapeHtml(record.fields.Name || '—') },
      { label: 'Role', render: (record) => escapeHtml(record.fields.Role || '—') },
      { label: 'Email', render: (record) => escapeHtml(record.fields.Email || '—') },
      {
        label: 'Assigned buses',
        render: (record) => escapeHtml(resolveBusNames(record.fields.AssignedBuses))
      }
    ]
  },
  students: {
    label: 'Students',
    singular: 'student',
    endpoint: '/students',
    summaryLabel: 'Student records',
    intro:
      'Each student links to a school and one assigned bus, plus the guardian contact and address details drivers need.',
    fields: [
      { name: 'Name', label: 'Student name', type: 'text', required: true },
      {
        name: 'School',
        label: 'School',
        type: 'link-single',
        options: () =>
          state.data.schools.map((record) => ({
            value: record.id,
            label: record.fields.Name || record.id
          }))
      },
      {
        name: 'AssignedBus',
        label: 'Assigned bus',
        type: 'link-single',
        options: () =>
          state.data.buses.map((record) => ({
            value: record.id,
            label: formatBusLabel(record)
          }))
      },
      { name: 'GuardianName', label: 'Guardian name', type: 'text' },
      { name: 'GuardianPhone', label: 'Guardian phone', type: 'tel' },
      { name: 'PickupAddress', label: 'Pickup address', type: 'text' },
      { name: 'DropoffAddress', label: 'Dropoff address', type: 'text' }
    ],
    columns: [
      { label: 'Name', render: (record) => escapeHtml(record.fields.Name || '—') },
      {
        label: 'School',
        render: (record) =>
          escapeHtml(resolveSchoolName(record.fields.School?.[0] || null))
      },
      {
        label: 'Assigned bus',
        render: (record) => escapeHtml(resolveBusNames(record.fields.AssignedBus))
      },
      {
        label: 'Guardian',
        render: (record) => escapeHtml(record.fields.GuardianName || '—')
      }
    ]
  }
};

void initialize();

async function initialize() {
  try {
    state.user = await requireUser('Admin');
  } catch {
    return;
  }

  userMeta.textContent = `${state.user.name || 'Admin'} • ${state.user.email}`;
  refreshButton.addEventListener('click', () => {
    void reloadAllData('Dashboard refreshed.');
  });
  logoutButton.addEventListener('click', () => {
    void logout();
  });
  panel.addEventListener('click', handlePanelClick);
  panel.addEventListener('submit', handlePanelSubmit);

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;

      if (ENTITY_CONFIG[state.activeTab]) {
        state.editing = {
          entity: state.activeTab,
          recordId: null
        };
      }

      render();
    });
  });

  await reloadAllData();
}

async function reloadAllData(successMessage) {
  setBanner(statusBanner, 'Loading dashboard data...');

  try {
    const [schools, buses, staff, students, triplogs, incidents] = await Promise.all([
      api('/schools'),
      api('/buses'),
      api('/staff'),
      api('/students'),
      api(`/triplogs${buildQuery(state.filters.triplogs)}`),
      api(`/incidents${buildQuery(state.filters.incidents)}`)
    ]);

    state.data.schools = schools.records || [];
    state.data.buses = buses.records || [];
    state.data.staff = staff.records || [];
    state.data.students = students.records || [];
    state.data.triplogs = triplogs.records || [];
    state.data.incidents = incidents.records || [];

    render();
    setBanner(statusBanner, successMessage || '');
  } catch (error) {
    setBanner(statusBanner, error.message, 'error');
  }
}

function render() {
  navButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tab === state.activeTab);
  });

  if (ENTITY_CONFIG[state.activeTab]) {
    panel.innerHTML = renderCrudTab(state.activeTab);
    return;
  }

  if (state.activeTab === 'triplogs') {
    panel.innerHTML = renderTripLogsTab();
    return;
  }

  panel.innerHTML = renderIncidentsTab();
}

function renderCrudTab(tabName) {
  const config = ENTITY_CONFIG[tabName];
  const records = state.data[tabName];
  const editingRecord =
    state.editing.entity === tabName && state.editing.recordId
      ? records.find((record) => record.id === state.editing.recordId) || null
      : null;

  return `
    <div class="stack">
      <div class="panel-header">
        <div>
          <p class="eyebrow">${escapeHtml(config.label)}</p>
          <h2>${escapeHtml(config.label)}</h2>
          <p class="muted">${escapeHtml(config.intro)}</p>
        </div>
      </div>

      <div class="summary-row">
        <div class="summary-card">
          <span>${escapeHtml(config.summaryLabel)}</span>
          <strong>${records.length}</strong>
        </div>
      </div>

      ${config.note ? `<div class="status-banner">${escapeHtml(config.note)}</div>` : ''}

      <div class="split-layout">
        <section class="route-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">${editingRecord ? 'Edit' : 'Create'}</p>
              <h2>${editingRecord ? `Update ${escapeHtml(config.singular)}` : `Add ${escapeHtml(config.singular)}`}</h2>
            </div>
            <button class="ghost-button mini-button" data-action="reset-form" type="button">
              Reset
            </button>
          </div>
          <form id="crud-form" class="stack" novalidate>
            <input type="hidden" name="recordId" value="${editingRecord?.id || ''}" />
            <div class="field-grid">
              ${config.fields.map((field) => renderField(field, editingRecord)).join('')}
            </div>
            <div class="inline-actions">
              <button class="secondary-button" type="submit">
                ${editingRecord ? 'Save changes' : `Create ${escapeHtml(config.singular)}`}
              </button>
            </div>
          </form>
        </section>

        <section class="route-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Records</p>
              <h2>${escapeHtml(config.label)} list</h2>
            </div>
          </div>
          ${renderTable(config.columns, records, true)}
        </section>
      </div>
    </div>
  `;
}

function renderTripLogsTab() {
  const records = state.data.triplogs;
  const pendingAm = records.filter((record) => record.fields.AMStatus === 'Pending').length;
  const pendingPm = records.filter((record) => record.fields.PMStatus === 'Pending').length;

  const columns = [
    {
      label: 'Date',
      render: (record) => escapeHtml(formatDateOnly(record.fields.Date))
    },
    {
      label: 'Student',
      render: (record) =>
        escapeHtml(resolveStudentName(record.fields.Student?.[0] || null))
    },
    {
      label: 'Bus',
      render: (record) => escapeHtml(resolveBusNames(record.fields.Bus))
    },
    {
      label: 'Driver',
      render: (record) => escapeHtml(resolveStaffName(record.fields.Driver?.[0] || null))
    },
    {
      label: 'AM',
      render: (record) => escapeHtml(record.fields.AMStatus || 'Pending')
    },
    {
      label: 'AM time',
      render: (record) => escapeHtml(formatDateTime(record.fields.AMTimestamp))
    },
    {
      label: 'PM',
      render: (record) => escapeHtml(record.fields.PMStatus || 'Pending')
    },
    {
      label: 'PM time',
      render: (record) => escapeHtml(formatDateTime(record.fields.PMTimestamp))
    }
  ];

  return `
    <div class="stack">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Trip Logs</p>
          <h2>Daily movement records</h2>
          <p class="muted">
            Filter by date, bus, or school to review pickup and dropoff activity.
          </p>
        </div>
      </div>

      <div class="summary-row">
        <div class="summary-card">
          <span>Visible records</span>
          <strong>${records.length}</strong>
        </div>
        <div class="summary-card">
          <span>AM pending</span>
          <strong>${pendingAm}</strong>
        </div>
        <div class="summary-card">
          <span>PM pending</span>
          <strong>${pendingPm}</strong>
        </div>
      </div>

      <section class="route-card">
        <form id="triplog-filter-form" class="stack" novalidate>
          <div class="field-grid">
            ${renderFilterField('triplogs', 'date', 'Date', 'date')}
            ${renderFilterSelect('triplogs', 'busId', 'Bus', state.data.buses, formatBusLabel)}
            ${renderFilterSelect(
              'triplogs',
              'schoolId',
              'School',
              state.data.schools,
              (record) => record.fields.Name || record.id
            )}
          </div>
          <div class="inline-actions">
            <button class="secondary-button" type="submit">Apply filters</button>
            <button class="ghost-button" data-action="clear-triplog-filters" type="button">
              Clear
            </button>
          </div>
        </form>
      </section>

      <section class="route-card">
        ${renderTable(columns, records, false)}
      </section>
    </div>
  `;
}

function renderIncidentsTab() {
  const records = state.data.incidents;
  const highSeverity = records.filter((record) => record.fields.Severity === 'High').length;

  const columns = [
    {
      label: 'Date',
      render: (record) => escapeHtml(formatDateOnly(record.fields.Date))
    },
    {
      label: 'Student',
      render: (record) =>
        escapeHtml(resolveStudentName(record.fields.Student?.[0] || null))
    },
    {
      label: 'Bus',
      render: (record) => escapeHtml(resolveBusNames(record.fields.Bus))
    },
    {
      label: 'Driver',
      render: (record) => escapeHtml(resolveStaffName(record.fields.Driver?.[0] || null))
    },
    {
      label: 'Severity',
      render: (record) => escapeHtml(record.fields.Severity || '—')
    },
    {
      label: 'Timestamp',
      render: (record) => escapeHtml(formatDateTime(record.fields.Timestamp))
    },
    {
      label: 'Description',
      render: (record) => escapeHtml(record.fields.Description || '—')
    }
  ];

  return `
    <div class="stack">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Incidents</p>
          <h2>Incident reporting</h2>
          <p class="muted">
            Review operational issues and follow up quickly on medium and high severity events.
          </p>
        </div>
      </div>

      <div class="summary-row">
        <div class="summary-card">
          <span>Visible incidents</span>
          <strong>${records.length}</strong>
        </div>
        <div class="summary-card">
          <span>High severity</span>
          <strong>${highSeverity}</strong>
        </div>
      </div>

      <section class="route-card">
        <form id="incident-filter-form" class="stack" novalidate>
          <div class="field-grid">
            ${renderFilterField('incidents', 'date', 'Date', 'date')}
            ${renderFilterSelect('incidents', 'busId', 'Bus', state.data.buses, formatBusLabel)}
            ${renderFilterSelect(
              'incidents',
              'schoolId',
              'School',
              state.data.schools,
              (record) => record.fields.Name || record.id
            )}
          </div>
          <div class="inline-actions">
            <button class="secondary-button" type="submit">Apply filters</button>
            <button class="ghost-button" data-action="clear-incident-filters" type="button">
              Clear
            </button>
          </div>
        </form>
      </section>

      <section class="route-card">
        ${renderTable(columns, records, false)}
      </section>
    </div>
  `;
}

function renderField(field, record) {
  const rawValue = record ? record.fields[field.name] : '';
  const value = Array.isArray(rawValue) ? rawValue : rawValue || '';
  const required = field.required ? 'required' : '';

  if (field.type === 'select' || field.type === 'link-single') {
    const options = typeof field.options === 'function' ? field.options() : field.options || [];
    const selectedValue =
      field.type === 'link-single' ? value[0] || '' : typeof value === 'string' ? value : '';

    return `
      <label class="field-group">
        <span>${escapeHtml(field.label)}</span>
        <select name="${escapeHtml(field.name)}" ${required}>
          <option value="">Select an option</option>
          ${options
            .map(
              (option) => `
                <option value="${escapeHtml(option.value)}" ${
                  option.value === selectedValue ? 'selected' : ''
                }>${escapeHtml(option.label)}</option>
              `
            )
            .join('')}
        </select>
      </label>
    `;
  }

  if (field.type === 'link-multi') {
    const options = typeof field.options === 'function' ? field.options() : field.options || [];
    const selectedValues = Array.isArray(value) ? value : [];

    return `
      <label class="field-group">
        <span>${escapeHtml(field.label)}</span>
        <select name="${escapeHtml(field.name)}" multiple>
          ${options
            .map(
              (option) => `
                <option value="${escapeHtml(option.value)}" ${
                  selectedValues.includes(option.value) ? 'selected' : ''
                }>${escapeHtml(option.label)}</option>
              `
            )
            .join('')}
        </select>
      </label>
    `;
  }

  return `
    <label class="field-group">
      <span>${escapeHtml(field.label)}</span>
      <input
        type="${escapeHtml(field.type)}"
        name="${escapeHtml(field.name)}"
        value="${escapeHtml(value)}"
        ${required}
      />
    </label>
  `;
}

function renderFilterField(scope, fieldName, label, type) {
  const value = state.filters[scope][fieldName] || '';

  return `
    <label class="field-group">
      <span>${escapeHtml(label)}</span>
      <input type="${escapeHtml(type)}" name="${escapeHtml(fieldName)}" value="${escapeHtml(value)}" />
    </label>
  `;
}

function renderFilterSelect(scope, fieldName, label, records, labelBuilder) {
  const selectedValue = state.filters[scope][fieldName] || '';

  return `
    <label class="field-group">
      <span>${escapeHtml(label)}</span>
      <select name="${escapeHtml(fieldName)}">
        <option value="">All</option>
        ${records
          .map(
            (record) => `
              <option value="${escapeHtml(record.id)}" ${
                record.id === selectedValue ? 'selected' : ''
              }>${escapeHtml(labelBuilder(record))}</option>
            `
          )
          .join('')}
      </select>
    </label>
  `;
}

function renderTable(columns, records, includeActions) {
  if (records.length === 0) {
    return '<div class="empty-state">No records yet for this view.</div>';
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            ${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}
            ${includeActions ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${records
            .map(
              (record) => `
                <tr>
                  ${columns
                    .map(
                      (column) => `
                        <td data-label="${escapeHtml(column.label)}">${column.render(record)}</td>
                      `
                    )
                    .join('')}
                  ${
                    includeActions
                      ? `
                        <td data-label="Actions">
                          <div class="table-actions">
                            <button class="secondary-button mini-button" data-action="edit-record" data-id="${escapeHtml(record.id)}" type="button">
                              Edit
                            </button>
                            <button class="ghost-button mini-button" data-action="delete-record" data-id="${escapeHtml(record.id)}" type="button">
                              Delete
                            </button>
                          </div>
                        </td>
                      `
                      : ''
                  }
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function handlePanelSubmit(event) {
  if (event.target.id === 'crud-form') {
    event.preventDefault();
    await saveCurrentRecord(event.target);
    return;
  }

  if (event.target.id === 'triplog-filter-form') {
    event.preventDefault();
    await applyFilters('triplogs', event.target);
    return;
  }

  if (event.target.id === 'incident-filter-form') {
    event.preventDefault();
    await applyFilters('incidents', event.target);
  }
}

async function handlePanelClick(event) {
  const actionTarget = event.target.closest('[data-action]');

  if (!actionTarget) {
    return;
  }

  const { action, id } = actionTarget.dataset;

  if (action === 'edit-record') {
    state.editing = {
      entity: state.activeTab,
      recordId: id
    };
    render();
    return;
  }

  if (action === 'delete-record') {
    const config = ENTITY_CONFIG[state.activeTab];

    if (!window.confirm(`Delete this ${config.singular}?`)) {
      return;
    }

    try {
      await api(`${config.endpoint}/${id}`, { method: 'DELETE' });
      state.editing = {
        entity: state.activeTab,
        recordId: null
      };
      await reloadAllData(`${config.singular} deleted.`);
    } catch (error) {
      setBanner(statusBanner, error.message, 'error');
    }

    return;
  }

  if (action === 'reset-form') {
    state.editing = {
      entity: state.activeTab,
      recordId: null
    };
    render();
    return;
  }

  if (action === 'clear-triplog-filters') {
    state.filters.triplogs = {
      date: todayInBrowser(),
      busId: '',
      schoolId: ''
    };
    await reloadAllData('Trip log filters cleared.');
    return;
  }

  if (action === 'clear-incident-filters') {
    state.filters.incidents = {
      date: todayInBrowser(),
      busId: '',
      schoolId: ''
    };
    await reloadAllData('Incident filters cleared.');
  }
}

async function saveCurrentRecord(form) {
  const config = ENTITY_CONFIG[state.activeTab];
  const payload = {};

  config.fields.forEach((field) => {
    const control = form.elements.namedItem(field.name);

    if (!control) {
      return;
    }

    if (field.type === 'link-multi') {
      payload[field.name] = [...control.selectedOptions].map((option) => option.value);
      return;
    }

    if (field.type === 'link-single') {
      payload[field.name] = control.value ? [control.value] : [];
      return;
    }

    if (field.type === 'number') {
      payload[field.name] = control.value === '' ? null : Number(control.value);
      return;
    }

    payload[field.name] = typeof control.value === 'string' ? control.value.trim() : control.value;
  });

  const recordId = form.elements.namedItem('recordId').value;

  try {
    const response = recordId
      ? await api(`${config.endpoint}/${recordId}`, {
          method: 'PATCH',
          body: payload
        })
      : await api(config.endpoint, {
          method: 'POST',
          body: payload
        });

    state.editing = {
      entity: state.activeTab,
      recordId: null
    };

    await reloadAllData(response.notice || `${config.label} saved.`);
  } catch (error) {
    setBanner(statusBanner, error.message, 'error');
  }
}

async function applyFilters(scope, form) {
  state.filters[scope] = {
    date: String(form.elements.namedItem('date').value || ''),
    busId: String(form.elements.namedItem('busId').value || ''),
    schoolId: String(form.elements.namedItem('schoolId').value || '')
  };

  await reloadAllData(`${scope === 'triplogs' ? 'Trip log' : 'Incident'} filters applied.`);
}

function formatBusLabel(record) {
  const plate = record.fields.PlateNumber || record.id;
  const route = record.fields.RouteName ? ` • ${record.fields.RouteName}` : '';
  return `${plate}${route}`;
}

function resolveBusNames(busIds) {
  const ids = Array.isArray(busIds) ? busIds : busIds ? [busIds] : [];

  if (ids.length === 0) {
    return '—';
  }

  return ids.map((id) => resolveBusName(id)).join(', ');
}

function resolveBusName(id) {
  if (!id) {
    return '—';
  }

  const record = state.data.buses.find((bus) => bus.id === id);
  return record ? formatBusLabel(record) : id;
}

function resolveSchoolName(id) {
  if (!id) {
    return '—';
  }

  const record = state.data.schools.find((school) => school.id === id);
  return record ? record.fields.Name || id : id;
}

function resolveStudentName(id) {
  if (!id) {
    return '—';
  }

  const record = state.data.students.find((student) => student.id === id);
  return record ? record.fields.Name || id : id;
}

function resolveStaffName(id) {
  if (!id) {
    return '—';
  }

  const record = state.data.staff.find((staff) => staff.id === id);
  return record ? record.fields.Name || id : id;
}
