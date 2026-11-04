import { existsSync } from 'fs';
import { basename, join } from 'path';

import { PRIVACY_URL, SUPPORT_URL, TERMS_URL } from '@/lib/legal';

test.each([PRIVACY_URL, TERMS_URL, SUPPORT_URL])('%s has a page in site/', (url) => {
  expect(url.startsWith('https://')).toBe(true);
  expect(existsSync(join(__dirname, '../../site', basename(url)))).toBe(true);
});
