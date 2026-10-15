const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const filename = resolve(__dirname, '../.env');
if (!existsSync(filename)) {
  throw new Error(
    'Copy .env.example to .env before configuring authentication.',
  );
}
let content = readFileSync(filename, 'utf8');
let changed = 0;
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  const pattern = new RegExp(`^${key}=(.*)$`, 'm');
  const match = content.match(pattern);
  const existing = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (existing) continue;
  const setting = `${key}=${randomBytes(48).toString('hex')}`;
  content = match
    ? content.replace(pattern, setting)
    : `${content.trimEnd()}\n${setting}\n`;
  changed++;
}
if (changed) writeFileSync(filename, content, { mode: 0o600 });
console.log(
  changed
    ? 'Missing local JWT secrets generated. No secret values were printed.'
    : 'JWT secrets already configured; no changes made.',
);
