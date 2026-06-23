import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import {
  AirtableClient,
  dateFormula,
  linkedRecordIds,
  serializeRecord
} from './airtable.js';

const TABLES = {
  schools: 'Schools',
  buses: 'Buses',
  staff: 'Staff',
  students: 'Students',
  tripLogs: 'TripLogs',
  incidents: 'Incidents'
};

const SESSION_COOKIE = 'schoolbus_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_TIMEZONE = 'Africa/Nairobi';
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:8788',
  'http://127.0.0.1:8788'
];

const CRUD_CONFIG = {
  schools: {
    tableName: TABLES.schools,
    allowedFields: ['Name', 'Address', 'ContactPerson', 'Phone'],
    requiredFields: ['Name'],
    sort: [{ field: 'Name', direction: 'asc' }]
  },
  buses: {
    tableName: TABLES.buses,
    allowedFields: ['PlateNumber', 'Capacity', 'Status', 'RouteName'],
    requiredFields: ['PlateNumber'],
    numberFields: ['Capacity'],
    enumFields: {
      Status: ['Active', 'Maintenance', 'Inactive']
    },
    sort: [{ field: 'PlateNumber', direction: 'asc' }]
  },
  staff: {
    tableName: TABLES.staff,
    allowedFields: ['Name', 'Role', 'Phone', 'Email', 'AssignedBuses'],
    requiredFields: ['Name', 'Role', 'Email'],
    enumFields: {
      Role: ['Admin', 'Driver']
    },
    linkFields: {
      AssignedBuses: 'multi'
    },
    sort: [{ field: 'Name', direction: 'asc' }]
  },
  students: {
    tableName: TABLES.students,
    allowedFields: [
      'Name',
      'School',
      'AssignedBus',
      'GuardianName',
      'GuardianPhone',
      'PickupAddress',
      'DropoffAddress'
    ],
    requiredFields: ['Name'],
    linkFields: {
      School: 'single',
      AssignedBus: 'single'
    },
    sort: [{ field: 'Name', direction: 'asc' }]
  }
};

const app = new Hono();
const api = new Hono();
const driverApi = new Hono();

function createHttpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function getAirtableClient(c) {
  return new AirtableClient(c.env);
}

function getNowDateInTimezone(timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(new Date());
}

function getAppTimezone(env) {
  return env.APP_TIMEZONE || DEFAULT_TIMEZONE;
}

function isSecureRequest(c) {
  return new URL(c.req.url).protocol === 'https:';
}

function isLocalDevRequest(c) {
  const { hostname } = new URL(c.req.url);
  return ['localhost', '127.0.0.1'].includes(hostname);
}

function normalizeSameSite(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'none') {
    return 'None';
  }

  if (normalized === 'strict') {
    return 'Strict';
  }

  if (normalized === 'lax') {
    return 'Lax';
  }

  return null;
}

function getSessionCookieOptions(c) {
  const secure = isSecureRequest(c);
  const configuredSameSite = normalizeSameSite(c.env.COOKIE_SAMESITE);

  return {
    httpOnly: true,
    sameSite:
      configuredSameSite || (secure || !isLocalDevRequest(c) ? 'Strict' : 'Lax'),
    secure: configuredSameSite === 'None' ? true : secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  };
}

function getAllowedOrigins(env) {
  const configuredOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
}

function sanitizeLinkedValue(mode, value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return mode === 'single' ? value.filter(Boolean).slice(0, 1) : value.filter(Boolean);
  }

  return [value];
}

function sanitizeFields(payload, config) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'Request body must be a JSON object.');
  }

  const sanitized = {};

  for (const fieldName of config.allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) {
      continue;
    }

    const rawValue = payload[fieldName];

    if (config.linkFields?.[fieldName]) {
      sanitized[fieldName] = sanitizeLinkedValue(config.linkFields[fieldName], rawValue);
      continue;
    }

    if (config.numberFields?.includes(fieldName)) {
      if (rawValue === '' || rawValue === null) {
        sanitized[fieldName] = null;
        continue;
      }

      const parsed = Number(rawValue);

      if (!Number.isFinite(parsed)) {
        throw createHttpError(400, `${fieldName} must be a valid number.`);
      }

      sanitized[fieldName] = parsed;
      continue;
    }

    if (config.enumFields?.[fieldName] && rawValue) {
      if (!config.enumFields[fieldName].includes(rawValue)) {
        throw createHttpError(
          400,
          `${fieldName} must be one of: ${config.enumFields[fieldName].join(', ')}.`
        );
      }
    }

    sanitized[fieldName] = rawValue;
  }

  return sanitized;
}

function ensureRequiredFields(fields, requiredFields) {
  for (const fieldName of requiredFields) {
    const value = fields[fieldName];

    if (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    ) {
      throw createHttpError(400, `${fieldName} is required.`);
    }
  }
}

async function parseJsonBody(c) {
  try {
    return await c.req.json();
  } catch {
    throw createHttpError(400, 'Request body must be valid JSON.');
  }
}

function serializeUser(staffRecord, authPayload) {
  return {
    id: staffRecord.id,
    name: staffRecord.fields.Name || '',
    email: staffRecord.fields.Email || authPayload.email,
    phone: staffRecord.fields.Phone || '',
    role: staffRecord.fields.Role || authPayload.role,
    assignedBusIds: linkedRecordIds(staffRecord.fields.AssignedBuses)
  };
}

function serializeBus(busRecord) {
  return {
    id: busRecord.id,
    plateNumber: busRecord.fields.PlateNumber || '',
    capacity: busRecord.fields.Capacity ?? null,
    status: busRecord.fields.Status || '',
    routeName: busRecord.fields.RouteName || ''
  };
}

function serializeStudent(studentRecord) {
  return {
    id: studentRecord.id,
    name: studentRecord.fields.Name || '',
    schoolId: linkedRecordIds(studentRecord.fields.School)[0] || null,
    assignedBusId: linkedRecordIds(studentRecord.fields.AssignedBus)[0] || null,
    guardianName: studentRecord.fields.GuardianName || '',
    guardianPhone: studentRecord.fields.GuardianPhone || '',
    pickupAddress: studentRecord.fields.PickupAddress || '',
    dropoffAddress: studentRecord.fields.DropoffAddress || ''
  };
}

function serializeTripLog(tripLogRecord) {
  return {
    id: tripLogRecord.id,
    studentId: linkedRecordIds(tripLogRecord.fields.Student)[0] || null,
    busId: linkedRecordIds(tripLogRecord.fields.Bus)[0] || null,
    driverId: linkedRecordIds(tripLogRecord.fields.Driver)[0] || null,
    date: tripLogRecord.fields.Date || '',
    amStatus: tripLogRecord.fields.AMStatus || 'Pending',
    amTimestamp: tripLogRecord.fields.AMTimestamp || null,
    pmStatus: tripLogRecord.fields.PMStatus || 'Pending',
    pmTimestamp: tripLogRecord.fields.PMTimestamp || null
  };
}

function serializeIncident(incidentRecord) {
  return {
    id: incidentRecord.id,
    studentId: linkedRecordIds(incidentRecord.fields.Student)[0] || null,
    busId: linkedRecordIds(incidentRecord.fields.Bus)[0] || null,
    driverId: linkedRecordIds(incidentRecord.fields.Driver)[0] || null,
    date: incidentRecord.fields.Date || '',
    timestamp: incidentRecord.fields.Timestamp || null,
    description: incidentRecord.fields.Description || '',
    severity: incidentRecord.fields.Severity || ''
  };
}

function buildDriverBusGroups({ buses, students, tripLogsByStudentId }) {
  return buses.map((busRecord) => {
    const bus = serializeBus(busRecord);
    const busStudents = students
      .filter(
        (studentRecord) =>
          linkedRecordIds(studentRecord.fields.AssignedBus)[0] === busRecord.id
      )
      .sort((left, right) =>
        (left.fields.Name || '').localeCompare(right.fields.Name || '')
      )
      .map((studentRecord) => {
        const student = serializeStudent(studentRecord);
        const tripLogRecord = tripLogsByStudentId.get(studentRecord.id);

        return {
          ...student,
          tripLog: tripLogRecord ? serializeTripLog(tripLogRecord) : null
        };
      });

    return {
      ...bus,
      students: busStudents
    };
  });
}

async function getDriverContext(c) {
  const cached = c.get('driverContext');

  if (cached) {
    return cached;
  }

  const auth = c.get('auth');
  const client = getAirtableClient(c);
  const staffRecord = await client.getRecord(TABLES.staff, auth.airtableStaffId);
  const assignedBusIds = linkedRecordIds(staffRecord.fields.AssignedBuses);

  const [allBuses, allStudents] = await Promise.all([
    client.listRecords(TABLES.buses, {
      sort: [{ field: 'RouteName', direction: 'asc' }]
    }),
    client.listRecords(TABLES.students, {
      sort: [{ field: 'Name', direction: 'asc' }]
    })
  ]);

  const buses = allBuses.filter((busRecord) => assignedBusIds.includes(busRecord.id));
  const students = allStudents.filter((studentRecord) =>
    assignedBusIds.includes(linkedRecordIds(studentRecord.fields.AssignedBus)[0])
  );

  const context = {
    staffRecord,
    assignedBusIds,
    buses,
    students,
    studentMap: new Map(students.map((studentRecord) => [studentRecord.id, studentRecord])),
    busMap: new Map(buses.map((busRecord) => [busRecord.id, busRecord]))
  };

  c.set('driverContext', context);
  return context;
}

function requireRole(role) {
  return async (c, next) => {
    const auth = c.get('auth');

    if (!auth || auth.role !== role) {
      throw createHttpError(403, `${role} access is required.`);
    }

    await next();
  };
}

function registerCrudRoutes(router, path, config, roleMiddleware) {
  router.get(`/${path}`, roleMiddleware, async (c) => {
    const client = getAirtableClient(c);
    const records = await client.listRecords(config.tableName, { sort: config.sort });

    return c.json({
      records: records.map(serializeRecord)
    });
  });

  router.post(`/${path}`, roleMiddleware, async (c) => {
    const body = await parseJsonBody(c);
    const fields = sanitizeFields(body.fields || body, config);
    ensureRequiredFields(fields, config.requiredFields);

    const client = getAirtableClient(c);
    const record = await client.createRecord(config.tableName, fields);
    const responsePayload = {
      record: serializeRecord(record)
    };

    if (path === 'staff') {
      responsePayload.notice =
        'Provision the staff login separately in Cloudflare KV after saving this record.';
    }

    return c.json(responsePayload, 201);
  });

  router.patch(`/${path}/:id`, roleMiddleware, async (c) => {
    const body = await parseJsonBody(c);
    const fields = sanitizeFields(body.fields || body, config);

    if (Object.keys(fields).length === 0) {
      throw createHttpError(400, 'At least one editable field is required.');
    }

    const client = getAirtableClient(c);
    const record = await client.updateRecord(config.tableName, c.req.param('id'), fields);

    return c.json({
      record: serializeRecord(record)
    });
  });

  router.delete(`/${path}/:id`, roleMiddleware, async (c) => {
    const client = getAirtableClient(c);
    await client.deleteRecord(config.tableName, c.req.param('id'));

    return c.json({
      deleted: true,
      id: c.req.param('id')
    });
  });
}

app.get('/', (c) =>
  c.json({
    ok: true,
    service: 'School Bus Ops API'
  })
);

app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowedOrigins = getAllowedOrigins(c.env);

  if (origin && allowedOrigins.has(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin');
  }

  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    return c.body(null, 204);
  }

  await next();
});

api.post('/login', async (c) => {
  const body = await parseJsonBody(c);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !password) {
    throw createHttpError(400, 'Email and password are required.');
  }

  const kvPayload = await c.env.STAFF_CREDENTIALS.get(`staff:${email}`, 'json');

  if (!kvPayload?.passwordHash || !kvPayload?.role || !kvPayload?.airtableStaffId) {
    throw createHttpError(401, 'Invalid email or password.');
  }

  const passwordMatches = bcrypt.compareSync(password, kvPayload.passwordHash);

  if (!passwordMatches) {
    throw createHttpError(401, 'Invalid email or password.');
  }

  const client = getAirtableClient(c);
  const staffRecord = await client.getRecord(TABLES.staff, kvPayload.airtableStaffId);

  if ((staffRecord.fields.Email || '').toLowerCase() !== email) {
    throw createHttpError(403, 'This staff account is not aligned with Airtable data.');
  }

  if (staffRecord.fields.Role !== kvPayload.role) {
    throw createHttpError(403, 'This staff account role does not match its credential record.');
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      email,
      role: kvPayload.role,
      airtableStaffId: kvPayload.airtableStaffId,
      iat: nowInSeconds,
      exp: nowInSeconds + SESSION_TTL_SECONDS
    },
    c.env.JWT_SECRET
  );

  setCookie(c, SESSION_COOKIE, token, getSessionCookieOptions(c));

  return c.json({
    success: true,
    user: serializeUser(staffRecord, {
      email,
      role: kvPayload.role
    })
  });
});

api.use('*', async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);

  if (!token) {
    throw createHttpError(401, 'Authentication is required.');
  }

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    c.set('auth', payload);
  } catch {
    throw createHttpError(401, 'Your session is invalid or has expired.');
  }

  await next();
});

api.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, getSessionCookieOptions(c));

  return c.json({ success: true });
});

api.get('/me', async (c) => {
  const auth = c.get('auth');
  const client = getAirtableClient(c);
  const staffRecord = await client.getRecord(TABLES.staff, auth.airtableStaffId);

  return c.json({
    user: serializeUser(staffRecord, auth)
  });
});

registerCrudRoutes(api, 'schools', CRUD_CONFIG.schools, requireRole('Admin'));
registerCrudRoutes(api, 'buses', CRUD_CONFIG.buses, requireRole('Admin'));
registerCrudRoutes(api, 'staff', CRUD_CONFIG.staff, requireRole('Admin'));
registerCrudRoutes(api, 'students', CRUD_CONFIG.students, requireRole('Admin'));

api.get('/triplogs', requireRole('Admin'), async (c) => {
  const client = getAirtableClient(c);
  const date = c.req.query('date');
  const busId = c.req.query('busId');
  const schoolId = c.req.query('schoolId');

  const [tripLogRecords, studentRecords] = await Promise.all([
    client.listRecords(TABLES.tripLogs, {
      filterByFormula: date ? dateFormula('Date', date) : undefined,
      sort: [{ field: 'Date', direction: 'desc' }]
    }),
    client.listRecords(TABLES.students)
  ]);

  const studentMap = new Map(studentRecords.map((studentRecord) => [studentRecord.id, studentRecord]));

  const filteredRecords = tripLogRecords.filter((tripLogRecord) => {
    const tripLogBusId = linkedRecordIds(tripLogRecord.fields.Bus)[0] || null;
    const tripLogStudentId = linkedRecordIds(tripLogRecord.fields.Student)[0] || null;
    const studentRecord = tripLogStudentId ? studentMap.get(tripLogStudentId) : null;
    const studentSchoolId = studentRecord
      ? linkedRecordIds(studentRecord.fields.School)[0] || null
      : null;

    if (busId && tripLogBusId !== busId) {
      return false;
    }

    if (schoolId && studentSchoolId !== schoolId) {
      return false;
    }

    return true;
  });

  return c.json({
    records: filteredRecords.map(serializeRecord)
  });
});

api.get('/incidents', requireRole('Admin'), async (c) => {
  const client = getAirtableClient(c);
  const date = c.req.query('date');
  const busId = c.req.query('busId');
  const schoolId = c.req.query('schoolId');

  const [incidentRecords, studentRecords] = await Promise.all([
    client.listRecords(TABLES.incidents, {
      filterByFormula: date ? dateFormula('Date', date) : undefined,
      sort: [{ field: 'Timestamp', direction: 'desc' }]
    }),
    client.listRecords(TABLES.students)
  ]);

  const studentMap = new Map(studentRecords.map((studentRecord) => [studentRecord.id, studentRecord]));

  const filteredRecords = incidentRecords.filter((incidentRecord) => {
    const incidentBusId = linkedRecordIds(incidentRecord.fields.Bus)[0] || null;
    const incidentStudentId = linkedRecordIds(incidentRecord.fields.Student)[0] || null;
    const studentRecord = incidentStudentId ? studentMap.get(incidentStudentId) : null;
    const studentSchoolId = studentRecord
      ? linkedRecordIds(studentRecord.fields.School)[0] || null
      : null;

    if (busId && incidentBusId !== busId) {
      return false;
    }

    if (schoolId && studentSchoolId !== schoolId) {
      return false;
    }

    return true;
  });

  return c.json({
    records: filteredRecords.map(serializeRecord)
  });
});

driverApi.use('*', requireRole('Driver'));

driverApi.get('/students', async (c) => {
  const auth = c.get('auth');
  const context = await getDriverContext(c);

  return c.json({
    user: serializeUser(context.staffRecord, auth),
    buses: buildDriverBusGroups({
      buses: context.buses,
      students: context.students,
      tripLogsByStudentId: new Map()
    })
  });
});

driverApi.get('/triplogs', async (c) => {
  const auth = c.get('auth');
  const context = await getDriverContext(c);
  const date = c.req.query('date') || getNowDateInTimezone(getAppTimezone(c.env));
  const client = getAirtableClient(c);

  const tripLogRecords = await client.listRecords(TABLES.tripLogs, {
    filterByFormula: dateFormula('Date', date)
  });

  const existingTripLogsByStudentId = new Map();

  for (const tripLogRecord of tripLogRecords) {
    const studentId = linkedRecordIds(tripLogRecord.fields.Student)[0];
    const busId = linkedRecordIds(tripLogRecord.fields.Bus)[0];

    if (
      studentId &&
      busId &&
      context.studentMap.has(studentId) &&
      context.assignedBusIds.includes(busId)
    ) {
      existingTripLogsByStudentId.set(studentId, tripLogRecord);
    }
  }

  const missingTripLogFields = context.students
    .filter((studentRecord) => !existingTripLogsByStudentId.has(studentRecord.id))
    .map((studentRecord) => ({
      Student: [studentRecord.id],
      Bus: [linkedRecordIds(studentRecord.fields.AssignedBus)[0]],
      Driver: [auth.airtableStaffId],
      Date: date,
      AMStatus: 'Pending',
      PMStatus: 'Pending'
    }));

  if (missingTripLogFields.length > 0) {
    const createdTripLogs = await client.createRecords(TABLES.tripLogs, missingTripLogFields);

    for (const tripLogRecord of createdTripLogs) {
      const studentId = linkedRecordIds(tripLogRecord.fields.Student)[0];

      if (studentId) {
        existingTripLogsByStudentId.set(studentId, tripLogRecord);
      }
    }
  }

  return c.json({
    date,
    user: serializeUser(context.staffRecord, auth),
    buses: buildDriverBusGroups({
      buses: context.buses,
      students: context.students,
      tripLogsByStudentId: existingTripLogsByStudentId
    })
  });
});

driverApi.patch('/triplogs/:id', async (c) => {
  const auth = c.get('auth');
  const context = await getDriverContext(c);
  const body = await parseJsonBody(c);
  const period = body.period;
  const status = body.status;

  if (!['AM', 'PM'].includes(period)) {
    throw createHttpError(400, 'period must be either AM or PM.');
  }

  const allowedStatuses =
    period === 'AM' ? ['Pending', 'PickedUp', 'Absent'] : ['Pending', 'DroppedOff', 'Absent'];

  if (!allowedStatuses.includes(status)) {
    throw createHttpError(400, `status must be one of: ${allowedStatuses.join(', ')}.`);
  }

  const client = getAirtableClient(c);
  const tripLogRecord = await client.getRecord(TABLES.tripLogs, c.req.param('id'));
  const tripLogBusId = linkedRecordIds(tripLogRecord.fields.Bus)[0] || null;
  const tripLogStudentId = linkedRecordIds(tripLogRecord.fields.Student)[0] || null;

  if (
    !tripLogBusId ||
    !tripLogStudentId ||
    !context.assignedBusIds.includes(tripLogBusId) ||
    !context.studentMap.has(tripLogStudentId)
  ) {
    throw createHttpError(403, 'You can only update trip logs for your assigned students.');
  }

  const fields =
    period === 'AM'
      ? {
          AMStatus: status,
          AMTimestamp: new Date().toISOString(),
          Driver: [auth.airtableStaffId]
        }
      : {
          PMStatus: status,
          PMTimestamp: new Date().toISOString(),
          Driver: [auth.airtableStaffId]
        };

  const updatedRecord = await client.updateRecord(TABLES.tripLogs, tripLogRecord.id, fields);

  return c.json({
    tripLog: serializeTripLog(updatedRecord)
  });
});

driverApi.post('/incidents', async (c) => {
  const auth = c.get('auth');
  const context = await getDriverContext(c);
  const body = await parseJsonBody(c);
  const studentId = body.studentId;
  const description = String(body.description || '').trim();
  const severity = body.severity;

  if (!studentId || !context.studentMap.has(studentId)) {
    throw createHttpError(400, 'studentId must belong to one of your assigned students.');
  }

  if (!description) {
    throw createHttpError(400, 'Description is required.');
  }

  if (!['Low', 'Medium', 'High'].includes(severity)) {
    throw createHttpError(400, 'Severity must be Low, Medium, or High.');
  }

  const studentRecord = context.studentMap.get(studentId);
  const busId = linkedRecordIds(studentRecord.fields.AssignedBus)[0];
  const currentDate = getNowDateInTimezone(getAppTimezone(c.env));
  const client = getAirtableClient(c);
  const incidentRecord = await client.createRecord(TABLES.incidents, {
    Student: [studentId],
    Bus: [busId],
    Driver: [auth.airtableStaffId],
    Date: currentDate,
    Timestamp: new Date().toISOString(),
    Description: description,
    Severity: severity
  });

  return c.json(
    {
      incident: serializeIncident(incidentRecord)
    },
    201
  );
});

api.route('/driver', driverApi);
app.route('/api', api);

app.notFound((c) =>
  c.json(
    {
      error: 'Not found.'
    },
    404
  )
);

app.onError((error, c) => {
  const status = Number.isInteger(error.status) ? error.status : 500;

  if (status >= 500) {
    console.error(error);
  }

  return c.json(
    {
      error: error.message || 'Internal server error.',
      details: error.details || undefined
    },
    status
  );
});

export default app;
