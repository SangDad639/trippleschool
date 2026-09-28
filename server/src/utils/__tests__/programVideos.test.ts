import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isProgramSlug,
  parseVideoId,
  readProgramVideoBody,
  PROGRAM_VIDEO_URL_MAX,
  PROGRAM_VIDEO_TITLE_MAX,
  PROGRAM_VIDEO_LINKS_MAX,
} from '../programVideos.js';

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

test('NUL bytes never reach Postgres (it rejects 0x00 in text with a 500)', () => {
  assert.match(readProgramVideoBody({ url: 'https://youtu.be/abc\u0000def' }).error ?? '', /ไม่ถูกต้อง/);
  assert.equal(readProgramVideoBody({ url: 'https://youtu.be/abcdefghijk', title: 'a\u0000b' }).values?.title, 'ab');
});

test('title is capped by code points so an emoji is never split in half', () => {
  const { values } = readProgramVideoBody({ url: 'https://youtu.be/abcdefghijk', title: '🎵'.repeat(300) });
  assert.equal(Array.from(values?.title ?? '').length, PROGRAM_VIDEO_TITLE_MAX);
  assert.equal(values?.title, '🎵'.repeat(PROGRAM_VIDEO_TITLE_MAX));
});

test('parseVideoId accepts only ids that fit the SERIAL (int4) column', () => {
  assert.equal(parseVideoId('1'), 1);
  assert.equal(parseVideoId(2147483647), 2147483647);
  for (const bad of ['0', '-1', '1.5', 'abc', '', '99999999999', 2147483648, null, undefined, true]) {
    assert.equal(parseVideoId(bad), null, `expected ${String(bad)} to be rejected`);
  }
});

const CLIP = 'https://youtu.be/abcdefghijk';

test('links are undefined when the field is absent — PUT keeps what is stored', () => {
  assert.equal(readProgramVideoBody({ url: CLIP }).values?.links, undefined);
});

test('an explicit empty list clears the links', () => {
  assert.deepEqual(readProgramVideoBody({ url: CLIP, links: [] }).values?.links, []);
});

test('manual links are trimmed and kept in order', () => {
  const { values } = readProgramVideoBody({
    url: CLIP,
    links: [
      { label: '  คู่มือการติดตั้ง ', url: ' https://docs.google.com/document/d/abc ' },
      { label: 'หน้าคู่มือ', url: '/guide/triple-voice' },
    ],
  });
  assert.deepEqual(values?.links, [
    { label: 'คู่มือการติดตั้ง', url: 'https://docs.google.com/document/d/abc' },
    { label: 'หน้าคู่มือ', url: '/guide/triple-voice' },
  ]);
});

test('a link without a label gets the default manual label', () => {
  assert.deepEqual(readProgramVideoBody({ url: CLIP, links: [{ label: ' ', url: 'https://x.com/m.pdf' }] }).values?.links, [
    { label: 'คู่มือการใช้งาน', url: 'https://x.com/m.pdf' },
  ]);
});

test('fully empty link rows are dropped, not rejected', () => {
  assert.deepEqual(readProgramVideoBody({ url: CLIP, links: [{ label: '', url: '' }, {}] }).values?.links, []);
});

test('link urls must be http(s) or a site path — they end up in an href', () => {
  for (const bad of ['javascript:alert(1)', '//evil.example/x', 'guide/x', 'ftp://x/y.pdf', 'https://x.com/\u0000']) {
    assert.match(readProgramVideoBody({ url: CLIP, links: [{ label: 'x', url: bad }] }).error ?? '', /ลิงก์คู่มือ/, bad);
  }
});

test('a label with no url is rejected instead of silently vanishing', () => {
  assert.match(readProgramVideoBody({ url: CLIP, links: [{ label: 'คู่มือ', url: '' }] }).error ?? '', /ลิงก์คู่มือ/);
});

test('at most PROGRAM_VIDEO_LINKS_MAX links per clip', () => {
  const many = Array.from({ length: PROGRAM_VIDEO_LINKS_MAX + 1 }, (_, i) => ({ label: `l${i}`, url: `https://x.com/${i}` }));
  assert.match(readProgramVideoBody({ url: CLIP, links: many }).error ?? '', /สูงสุด/);
  assert.equal(readProgramVideoBody({ url: CLIP, links: many.slice(1) }).values?.links?.length, PROGRAM_VIDEO_LINKS_MAX);
});

test('links that are not an array are rejected', () => {
  assert.match(readProgramVideoBody({ url: CLIP, links: 'https://x.com' }).error ?? '', /ลิงก์คู่มือ/);
});

test('non-string fields are treated as empty instead of throwing', () => {
  const { values } = readProgramVideoBody({ url: 'https://youtu.be/abcdefghijk', title: { evil: true } });
  assert.equal(values?.title, '');
  assert.equal(readProgramVideoBody(null).error, 'ต้องใส่ลิงก์คลิป');
});
