// Load dotenv FIRST before any other imports
import './config.js';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import subscriptionRoutes from './routes/subscription.js';
import adminRoutes from './routes/admin.js';
import affiliateRoutes from './routes/affiliate.js';
import tutorialsRoutes from './routes/tutorials.js';
import coursesRoutes from './routes/courses.js';
import enrollmentsRoutes from './routes/enrollments.js';
import pool from './db.js';
import { startSubscriptionNotificationJob } from './jobs/subscriptionNotificationJob.js';

// ========== STARTUP ENV VALIDATION ==========
const REQUIRED_ENV_VARS = ['DATABASE_URL', 'JWT_SECRET'] as const;
const RECOMMENDED_ENV_VARS = ['FRONTEND_URL'] as const;

const missingRequired: string[] = [];
const missingRecommended: string[] = [];

for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    missingRequired.push(envVar);
  }
}

for (const envVar of RECOMMENDED_ENV_VARS) {
  if (!process.env[envVar]) {
    missingRecommended.push(envVar);
  }
}

if (missingRequired.length > 0) {
  console.error('❌ CRITICAL: Missing required environment variables:');
  missingRequired.forEach(v => console.error(`   - ${v}`));
  console.error('\n   Server cannot start without these variables.');
  process.exit(1);
}

if (missingRecommended.length > 0) {
  console.warn('⚠️  WARNING: Missing recommended environment variables:');
  missingRecommended.forEach(v => console.warn(`   - ${v}`));
  console.warn('   Server will start but some features may not work correctly.\n');
}

console.log('✅ Environment validation passed');
// =============================================

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173', // Vite dev server
  'http://localhost:5174', // Vite dev server (fallback port)
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    // Allow any localhost port in development
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (allowedOrigins.includes(origin) || isLocalhost) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/affiliate', affiliateRoutes);
app.use('/api/tutorials', tutorialsRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/enrollments', enrollmentsRoutes);

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        credits INTEGER DEFAULT 100,
        is_admin BOOLEAN DEFAULT false,
        join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create system_settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(255) UNIQUE NOT NULL,
        setting_value TEXT
      )
    `);

    // Add total_credits_used and updated_at columns for credit tracking
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS total_credits_used INTEGER DEFAULT 0
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `).catch(() => {});

    // Add google_id column and make password_hash nullable for Google OAuth
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255)
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL
    `).catch(() => {});

    console.log('Database tables initialized');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Initialize database
  initializeDatabase();

  // Cron jobs use in-process node-cron (no distributed lock)
  // → only run on instances explicitly opted in via RUN_JOBS env var
  // → in single-replica deployment, omit RUN_JOBS or set it to 'true'
  // → in multi-replica deployment, set RUN_JOBS=true on exactly ONE replica
  // → defaults to enabled when unset to preserve existing single-instance behavior
  const runJobs = process.env.RUN_JOBS === undefined ? true : process.env.RUN_JOBS === 'true';

  if (!runJobs) {
    console.log('⏭️  Cron jobs disabled (RUN_JOBS=false) — this replica handles requests only');
    return;
  }

  console.log('▶️  Starting cron jobs (RUN_JOBS=true)');

  // Start subscription notification job (expiration warnings)
  startSubscriptionNotificationJob();
  console.log('Subscription notification job started');
});

export default app;
