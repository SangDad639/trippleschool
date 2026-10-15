// Harness ทดสอบเส้น /api/tripleidol/* กับ DB จริง โดยไม่บูต index.ts (ไม่รัน initializeDatabase / jobs / cron)
// รันจาก server/:  npx tsx scripts/dev-tripleidol-server.ts   → http://127.0.0.1:3101/api/tripleidol/...
// ใช้ JWT_SECRET จาก server/.env — token ที่ออกจากที่นี่ใช้กับ prod ได้ก็ต่อเมื่อ secret ตรงกัน
import 'dotenv/config';
import express from 'express';
import tripleidolRoutes from '../src/routes/tripleidol.js';

const PORT = Number(process.env.IDOL_HARNESS_PORT || 3101);
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/tripleidol', tripleidolRoutes);
app.get('/health', (_req, res) => res.json({ ok: true, harness: 'tripleidol' }));
app.listen(PORT, '127.0.0.1', () => console.log(`tripleidol harness on http://127.0.0.1:${PORT}`));
