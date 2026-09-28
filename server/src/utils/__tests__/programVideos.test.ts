import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProgramSlug, readProgramVideoBody, PROGRAM_VIDEO_URL_MAX, PROGRAM_VIDEO_TITLE_MAX } from '../programVideos.js';

test('accepts the slugs used in programsData.ts', () => {
  assert.equal(isProgramSlug('triple-voice'), true);
  assert.equal(isProgramSlug('triple-music'), true);
});

test('rejects slugs that are not lowercase kebab-case', () => {
  for (const bad of ['', 'Triple-Music', 'triple music', '../etc', 'a'.repeat(65), undefined, 42]) {
    assert.equal(isProgramSlug(bad), false, `expected ${String(bad)} to be rejected`);
  }
});

test('requires a url', () => {
  assert.equal(readProgramVideoBody({ title: 'x' }).error, 'ต้องใส่ลิงก์คลิป');
  assert.equal(readProgramVideoBody({ url: '   ' }).error, 'ต้องใส่ลิงก์คลิป');
});

test('rejects non-http urls because they end up in an iframe src', () => {
  assert.match(readProgramVideoBody({ url: 'javascript:alert(1)' }).error ?? '', /http/);
  assert.match(readProgramVideoBody({ url: 'ftp://x/y.mp4' }).error ?? '', /http/);
});

test('trims and caps title and url', () => {
  const longTitle = 'ก'.repeat(PROGRAM_VIDEO_TITLE_MAX + 50);
  const { values } = readProgramVideoBody({
    title: `  ${longTitle}  `,
    url: `  https://youtu.be/abcdefghijk  `,
  });
  assert.equal(values?.title.length, PROGRAM_VIDEO_TITLE_MAX);
  assert.equal(values?.url, 'https://youtu.be/abcdefghijk');
});

test('url longer than the cap is rejected — a cut url would be a broken link', () => {
  const url = `https://example.com/${'a'.repeat(PROGRAM_VIDEO_URL_MAX)}.mp4`;
  assert.match(readProgramVideoBody({ url }).error ?? '', /ยาวเกิน/);
});

test('is_active defaults to true and only an explicit false hides the clip', () => {
  assert.equal(readProgramVideoBody({ url: 'https://youtu.be/abcdefghijk' }).values?.is_active, true);
  assert.equal(readProgramVideoBody({ url: 'https://youtu.be/abcdefghijk', is_active: false }).values?.is_active, false);
  assert.equal(readProgramVideoBody({ url: 'https://youtu.be/abcdefghijk', is_active: 'false' }).values?.is_active, true);
});

test('non-string fields are treated as empty instead of throwing', () => {
  const { values } = readProgramVideoBody({ url: 'https://youtu.be/abcdefghijk', title: { evil: true } });
  assert.equal(values?.title, '');
  assert.equal(readProgramVideoBody(null).error, 'ต้องใส่ลิงก์คลิป');
});
