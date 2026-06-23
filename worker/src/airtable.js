const AIRTABLE_API_ROOT = 'https://api.airtable.com/v0';
const AIRTABLE_BATCH_LIMIT = 10;

function createError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function toSearchParams(options = {}) {
  const params = new URLSearchParams();

  if (options.filterByFormula) {
    params.set('filterByFormula', options.filterByFormula);
  }

  if (options.pageSize) {
    params.set('pageSize', String(options.pageSize));
  }

  if (options.maxRecords) {
    params.set('maxRecords', String(options.maxRecords));
  }

  if (Array.isArray(options.sort)) {
    options.sort.forEach((sortOption, index) => {
      params.set(`sort[${index}][field]`, sortOption.field);
      params.set(`sort[${index}][direction]`, sortOption.direction || 'asc');
    });
  }

  if (options.offset) {
    params.set('offset', options.offset);
  }

  return params;
}

function chunk(items, size) {
  const batches = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

export class AirtableClient {
  constructor(env) {
    this.baseId = env.AIRTABLE_BASE_ID;
    this.token = env.AIRTABLE_PAT;

    if (!this.baseId || !this.token) {
      throw createError(500, 'Airtable environment variables are missing.');
    }
  }

  buildUrl(tableName, searchParams) {
    const encodedTableName = encodeURIComponent(tableName);
    const url = new URL(`${AIRTABLE_API_ROOT}/${this.baseId}/${encodedTableName}`);

    if (searchParams) {
      url.search = searchParams.toString();
    }

    return url;
  }

  async request(tableName, init = {}, searchParams) {
    const url = this.buildUrl(tableName, searchParams);
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const upstreamMessage =
        payload?.error?.message ||
        payload?.message ||
        `Airtable request failed with status ${response.status}.`;
      const status =
        response.status === 404 ? 404 : response.status >= 500 ? 502 : 400;

      throw createError(status, upstreamMessage, payload);
    }

    return payload;
  }

  async listRecords(tableName, options = {}) {
    const records = [];
    let offset;

    do {
      const payload = await this.request(
        tableName,
        { method: 'GET' },
        toSearchParams({ ...options, offset })
      );

      records.push(...(payload.records || []));
      offset = payload.offset;
    } while (offset);

    return records;
  }

  async getRecord(tableName, recordId) {
    const encodedTableName = encodeURIComponent(tableName);
    const encodedRecordId = encodeURIComponent(recordId);
    const response = await fetch(
      `${AIRTABLE_API_ROOT}/${this.baseId}/${encodedTableName}/${encodedRecordId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      }
    );

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const upstreamMessage =
        payload?.error?.message ||
        payload?.message ||
        `Airtable request failed with status ${response.status}.`;
      const status =
        response.status === 404 ? 404 : response.status >= 500 ? 502 : 400;

      throw createError(status, upstreamMessage, payload);
    }

    return payload;
  }

  async createRecord(tableName, fields) {
    const records = await this.createRecords(tableName, [fields]);
    return records[0];
  }

  async createRecords(tableName, fieldsList) {
    const batches = chunk(fieldsList, AIRTABLE_BATCH_LIMIT);
    const created = [];

    for (const batch of batches) {
      const payload = await this.request(
        tableName,
        {
          method: 'POST',
          body: JSON.stringify({
            records: batch.map((fields) => ({ fields })),
            typecast: true
          })
        }
      );

      created.push(...(payload.records || []));
    }

    return created;
  }

  async updateRecord(tableName, recordId, fields) {
    const encodedTableName = encodeURIComponent(tableName);
    const encodedRecordId = encodeURIComponent(recordId);
    const response = await fetch(
      `${AIRTABLE_API_ROOT}/${this.baseId}/${encodedTableName}/${encodedRecordId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields,
          typecast: true
        })
      }
    );

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const upstreamMessage =
        payload?.error?.message ||
        payload?.message ||
        `Airtable request failed with status ${response.status}.`;
      const status =
        response.status === 404 ? 404 : response.status >= 500 ? 502 : 400;

      throw createError(status, upstreamMessage, payload);
    }

    return payload;
  }

  async deleteRecord(tableName, recordId) {
    const encodedTableName = encodeURIComponent(tableName);
    const encodedRecordId = encodeURIComponent(recordId);
    const response = await fetch(
      `${AIRTABLE_API_ROOT}/${this.baseId}/${encodedTableName}/${encodedRecordId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      }
    );

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const upstreamMessage =
        payload?.error?.message ||
        payload?.message ||
        `Airtable request failed with status ${response.status}.`;
      const status =
        response.status === 404 ? 404 : response.status >= 500 ? 502 : 400;

      throw createError(status, upstreamMessage, payload);
    }

    return payload;
  }
}

export function serializeRecord(record) {
  return {
    id: record.id,
    createdTime: record.createdTime,
    fields: record.fields || {}
  };
}

export function linkedRecordIds(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function escapeAirtableString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

export function dateFormula(fieldName, dateString) {
  return `IS_SAME({${fieldName}}, '${escapeAirtableString(dateString)}', 'day')`;
}
