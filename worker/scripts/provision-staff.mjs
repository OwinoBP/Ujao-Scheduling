import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';

const VALID_ROLES = new Set(['Admin', 'Driver']);

function usage() {
  console.log(`
Usage:
  npm run provision-staff -- --email <email> --password <password> --role <Admin|Driver> --airtableStaffId <rec...> [--local|--remote] [--preview|--preview false] [--dry-run]

Examples:
  npm run provision-staff -- --email driver@example.com --password "DriverPass123!" --role Driver --airtableStaffId recXXXXXXXXXXXXXX --local --preview
  npm run provision-staff -- --email admin@example.com --password "AdminPass123!" --role Admin --airtableStaffId recXXXXXXXXXXXXXX --remote --preview false
`);
}

function parseArgs(argv) {
  const options = {
    target: 'local',
    preview: true,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--email') {
      options.email = next;
      index += 1;
    } else if (arg === '--password') {
      options.password = next;
      index += 1;
    } else if (arg === '--role') {
      options.role = next;
      index += 1;
    } else if (arg === '--airtableStaffId') {
      options.airtableStaffId = next;
      index += 1;
    } else if (arg === '--local') {
      options.target = 'local';
    } else if (arg === '--remote') {
      options.target = 'remote';
    } else if (arg === '--preview') {
      if (next === 'false') {
        options.preview = false;
        index += 1;
      } else {
        options.preview = true;
      }
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function validateOptions(options) {
  if (options.help) {
    usage();
    process.exit(0);
  }

  if (!options.email || !options.password || !options.role || !options.airtableStaffId) {
    throw new Error('email, password, role, and airtableStaffId are required.');
  }

  if (!VALID_ROLES.has(options.role)) {
    throw new Error('role must be Admin or Driver.');
  }

  if (!options.airtableStaffId.startsWith('rec')) {
    throw new Error('airtableStaffId should be the Airtable record ID and usually starts with rec.');
  }
}

function runWrangler({ key, credentialPath, target, preview }) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = [
    'wrangler',
    'kv',
    'key',
    'put',
    key,
    '--path',
    credentialPath,
    '--binding=STAFF_CREDENTIALS',
    preview ? '--preview' : '--preview=false',
    target === 'remote' ? '--remote' : '--local'
  ];

  return spawnSync(npx, args, {
    stdio: 'inherit',
    shell: false
  });
}

try {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);

  const email = options.email.trim().toLowerCase();
  const key = `staff:${email}`;
  const passwordHash = bcrypt.hashSync(options.password, bcrypt.genSaltSync(10));
  const credential = {
    passwordHash,
    role: options.role,
    airtableStaffId: options.airtableStaffId
  };

  if (options.dryRun) {
    console.log(JSON.stringify({ key, value: credential }, null, 2));
    process.exit(0);
  }

  const tempDirectory = mkdtempSync(join(tmpdir(), 'schoolbus-credential-'));
  const credentialPath = join(tempDirectory, 'credential.json');

  try {
    writeFileSync(credentialPath, JSON.stringify(credential), 'utf8');

    const result = runWrangler({
      key,
      credentialPath,
      target: options.target,
      preview: options.preview
    });

    if (result.status !== 0) {
      process.exit(result.status || 1);
    }

    console.log(`Provisioned ${options.role} login for ${email}.`);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(1);
}
