import express from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/requireSubscription.js';
import { getObjectBuffer, getSignedFileUrl } from '../utils/s3.js';
import { desktopVersionHandler } from './desktopVersion.js';

// Triple Music (โปรแกรม desktop · repo yue-lab) — mount ที่ /api/triplemusic
//   GET /version  feed อัปเดตอัตโนมัติ · S3 channel triplemusic/ · ดู routes/desktopVersion.ts
//   คู่มือออกรุ่น/publish: yue-lab/docs/auto-update.md

const APP = 'triplemusic';
const router = express.Router();

router.get(
  '/version',
  authenticate,
  requireSubscription,
  desktopVersionHandler({ app: APP }, { readObject: getObjectBuffer, signUrl: getSignedFileUrl, db: pool }),
);

export default router;
