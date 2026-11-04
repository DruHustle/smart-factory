import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const script = fileURLToPath(new URL('./split-render-env.mjs', import.meta.url));
function split(input) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-mail-env-'));
  try {
    writeFileSync(join(dir, '.env.prod'), input, { mode: 0o600 });
    execFileSync(process.execPath, [script], { cwd: dir });
    const output = {};
    for (const role of ['api', 'worker']) {
      const path = join(dir, `.env.prod.${role}`);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      output[role] = readFileSync(path, 'utf8');
    }
    return output;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('Resend configuration keeps sending credentials only on the worker', () => {
  const result = split('EMAIL_PROVIDER=resend\nRESEND_API_KEY=re_test_only\nEMAIL_DELIVERY_CONFIGURED=true\nPASSWORD_RESET_ORIGIN=https://factory.onesa.eu\n');
  assert.match(result.api, /^EMAIL_PROVIDER=resend$/m);
  assert.match(result.api, /^EMAIL_DELIVERY_CONFIGURED=true$/m);
  assert.doesNotMatch(result.api, /RESEND_API_KEY|re_test_only/);
  assert.match(result.worker, /^RESEND_API_KEY=re_test_only$/m);
  assert.match(result.worker, /^RESEND_FROM=Smart Factory <notifications-factory@onesa.eu>$/m);
  assert.match(result.worker, /^RESEND_ALLOWED_RECIPIENT_DOMAINS=onesa.eu$/m);
  for (const content of Object.values(result)) {
    assert.match(content, /^PASSWORD_RESET_ORIGIN=https:\/\/factory.onesa.eu$/m);
    assert.doesNotMatch(content, /gmail\.com|Google app password|SES_ENABLED=true/);
  }
});
test('an empty source cannot claim configured delivery or enable a legacy sender', () => {
  const result = split('');
  assert.match(result.api, /^EMAIL_DELIVERY_CONFIGURED=false$/m);
  assert.match(result.worker, /^RESEND_API_KEY=$/m);
  assert.match(result.worker, /^SES_ENABLED=false$/m);
  assert.doesNotMatch(result.worker, /gmail\.com|SMTP_HOST=\S/);
});
