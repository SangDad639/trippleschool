import { GUIDE_CATEGORIES, type GuideBlock, type GuideCategoryId, type GuideDoc, type Localized } from './guideTypes';
import { START_DOCS } from './docs/start';
import { PAYMENT_DOCS } from './docs/payment';
import { LEARNING_DOCS } from './docs/learning';
import { PERKS_DOCS } from './docs/perks';
import { ACCOUNT_DOCS } from './docs/account';
import { SUPPORT_DOCS } from './docs/support';

/**
 * คู่มือทั้งหมดของ /guide — ลำดับในอาร์เรย์นี้คือลำดับที่แสดงในหน้ารวม
 * และเป็นลำดับของปุ่ม "คู่มือก่อนหน้า / ถัดไป" ท้ายบทความ
 */
export const GUIDE_DOCS: GuideDoc[] = [
  ...START_DOCS,
  ...PAYMENT_DOCS,
  ...LEARNING_DOCS,
  ...PERKS_DOCS,
  ...ACCOUNT_DOCS,
  ...SUPPORT_DOCS,
];

/** 3 ก้าวแรกที่แนะนำให้คนใหม่อ่านตามลำดับ (แถบ "เริ่มที่นี่" บนหน้ารวม) */
export const GUIDE_QUICK_START: string[] = ['getting-started', 'choose-plan', 'learn-course'];

export const getGuide = (slug?: string): GuideDoc | undefined =>
  GUIDE_DOCS.find((doc) => doc.slug === slug);

export const guidesInCategory = (id: GuideCategoryId): GuideDoc[] =>
  GUIDE_DOCS.filter((doc) => doc.category === id);

/** หมวดที่มีคู่มืออยู่จริง — กันหมวดว่างโผล่ในหน้ารวม */
export const usedCategories = () =>
  GUIDE_CATEGORIES.filter((cat) => guidesInCategory(cat.id).length > 0);

const localizedText = (value: Localized) => `${value.th} ${value.en}`;

/** ดึงข้อความทั้งหมดในบล็อกออกมาเป็นสตริงเดียว — ใช้ทำ index ค้นหา */
function blockText(block: GuideBlock): string {
  switch (block.kind) {
    case 'para':
    case 'heading':
      return localizedText(block.body);
    case 'steps':
      return block.items.map((i) => localizedText(i.title) + (i.body ? ' ' + localizedText(i.body) : '')).join(' ');
    case 'list':
      return [block.title, ...block.items].filter(Boolean).map((i) => localizedText(i as Localized)).join(' ');
    case 'callout':
      return (block.title ? localizedText(block.title) + ' ' : '') + localizedText(block.body);
    case 'table':
      return [...block.cols, ...block.rows.flat()].map(localizedText).join(' ');
    case 'faq':
      return block.items.map((i) => localizedText(i.q) + ' ' + localizedText(i.a)).join(' ');
    case 'video':
      return localizedText(block.title);
    case 'links':
      return block.items.map((i) => localizedText(i.label)).join(' ');
    default:
      return '';
  }
}

/**
 * ข้อความค้นหาของคู่มือหนึ่งหน้า (สองภาษารวมกัน) — คำนวณครั้งเดียวแล้วแคชไว้
 * เนื้อหาเป็น static ทั้งหมด จึงไม่ต้องล้างแคช
 */
const searchIndex = new Map<string, string>();

function docSearchText(doc: GuideDoc): string {
  const cached = searchIndex.get(doc.slug);
  if (cached) return cached;
  const text = [
    localizedText(doc.title),
    localizedText(doc.summary),
    ...(doc.keywords || []),
    ...doc.blocks.map(blockText),
  ]
    .join(' ')
    .toLowerCase();
  searchIndex.set(doc.slug, text);
  return text;
}

/** ค้นหาแบบ AND ทุกคำ — พิมพ์ไทยหรืออังกฤษก็เจอ เพราะ index เก็บทั้งสองภาษา */
export function searchGuides(query: string): GuideDoc[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return GUIDE_DOCS;
  return GUIDE_DOCS.filter((doc) => {
    const haystack = docSearchText(doc);
    return terms.every((term) => haystack.includes(term));
  });
}

/** หัวข้อย่อยในคู่มือ → สารบัญด้านข้าง (anchor id ผูกกับลำดับบล็อก) */
export function guideHeadings(doc: GuideDoc): { id: string; text: Localized }[] {
  return doc.blocks
    .map((block, index) => (block.kind === 'heading' ? { id: `s${index}`, text: block.body } : null))
    .filter((h): h is { id: string; text: Localized } => h !== null);
}

/** คู่มือก่อนหน้า / ถัดไป ตามลำดับใน GUIDE_DOCS */
export function guideNeighbors(slug: string): { prev?: GuideDoc; next?: GuideDoc } {
  const index = GUIDE_DOCS.findIndex((doc) => doc.slug === slug);
  if (index === -1) return {};
  return { prev: GUIDE_DOCS[index - 1], next: GUIDE_DOCS[index + 1] };
}
