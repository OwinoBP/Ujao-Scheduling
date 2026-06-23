import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run hash-password -- "PlainTextPassword"');
  process.exit(1);
}

const salt = bcrypt.genSaltSync(10);
const passwordHash = bcrypt.hashSync(password, salt);

console.log(passwordHash);

