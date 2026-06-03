/**
 * Credit Service
 *
 * Handles all credit-related operations including:
 * - Deducting credits
 * - Refunding credits
 * - Recording transactions
 * - Getting transaction history
 */

import pool from '../db.js';
import { PoolClient } from 'pg';

export interface CreditTransaction {
  id?: number;
  userId: number;
  type: 'deduct' | 'refund' | 'purchase' | 'admin_add' | 'admin_deduct' | 'bonus' | 'registration';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  metadata?: any;
  createdByAdminId?: number;
  createdAt?: Date;
}

/**
 * Refund credits to a user (with transaction recording)
 * This is used when a video generation task fails
 */
export async function refundCredits(
  userId: number,
  amount: number,
  referenceType: string,
  referenceId: string,
  description: string
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ IDEMPOTENCY CHECK: Check if this exact refund already exists
    const existingRefund = await client.query(
      `SELECT id, balance_after FROM credit_transactions
       WHERE user_id = $1 AND reference_type = $2 AND reference_id = $3 AND type = 'refund'
       LIMIT 1`,
      [userId, referenceType, referenceId]
    );

    if (existingRefund.rows.length > 0) {
      await client.query('ROLLBACK');
      console.warn(`⚠️  [CreditService] Refund already exists for ${referenceType}/${referenceId}`);
      return {
        success: true,
        balanceAfter: existingRefund.rows[0].balance_after,
        error: 'Refund already processed (idempotent)'
      };
    }

    // Get current balance (with row lock)
    const userResult = await client.query(
      'SELECT credits FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, balanceAfter: 0, error: 'User not found' };
    }

    const balanceBefore = userResult.rows[0].credits;

    // Add credits back
    const updateResult = await client.query(
      `UPDATE users
       SET credits = credits + $1,
           total_credits_used = total_credits_used - $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING credits`,
      [amount, userId]
    );

    const balanceAfter = updateResult.rows[0].credits;

    // ✅ INSERT VERIFICATION: Record transaction and verify it succeeded
    const insertResult = await client.query(
      `INSERT INTO credit_transactions
       (user_id, type, amount, balance_before, balance_after, reference_type, reference_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [userId, 'refund', amount, balanceBefore, balanceAfter, referenceType, referenceId, description]
    );

    // ✅ CRITICAL: Verify INSERT succeeded
    if (!insertResult.rowCount || insertResult.rowCount === 0) {
      throw new Error('Failed to record credit refund transaction - INSERT returned 0 rows');
    }

    await client.query('COMMIT');

    console.log(JSON.stringify({
      event: 'credit_refund',
      userId,
      amount,
      balanceBefore,
      balanceAfter,
      referenceType,
      referenceId,
      description,
      transactionId: insertResult.rows[0].id,
      success: true,
      timestamp: new Date().toISOString()
    }));

    return { success: true, balanceAfter };

  } catch (error) {
    // ✅ SAFE ROLLBACK: Wrap in try-catch to prevent double-throw
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(`❌ [CreditService] ROLLBACK failed for user ${userId}:`, rollbackError);
    }

    console.error(JSON.stringify({
      event: 'credit_refund_failed',
      userId,
      amount,
      referenceType,
      referenceId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }));

    return {
      success: false,
      balanceAfter: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    client.release();
  }
}

/**
 * Deduct credits from a user (with transaction recording)
 * This is used when a video generation task starts
 */
export async function deductCredits(
  userId: number,
  amount: number,
  referenceType: string,
  referenceId: string,
  description: string
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ IDEMPOTENCY CHECK: Check if this exact transaction already exists
    const existingTx = await client.query(
      `SELECT id, balance_after FROM credit_transactions
       WHERE user_id = $1 AND reference_type = $2 AND reference_id = $3 AND type = 'deduct'
       LIMIT 1`,
      [userId, referenceType, referenceId]
    );

    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      console.warn(`⚠️  [CreditService] Transaction already exists for ${referenceType}/${referenceId}`);
      return {
        success: true,
        balanceAfter: existingTx.rows[0].balance_after,
        error: 'Transaction already processed (idempotent)'
      };
    }

    // Get current balance (with row lock)
    const userResult = await client.query(
      'SELECT credits FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, balanceAfter: 0, error: 'User not found' };
    }

    const balanceBefore = userResult.rows[0].credits;

    // Check sufficient credits
    if (balanceBefore < amount) {
      await client.query('ROLLBACK');
      return {
        success: false,
        balanceAfter: balanceBefore,
        error: `Insufficient credits (has: ${balanceBefore}, needs: ${amount})`
      };
    }

    // Deduct credits
    const updateResult = await client.query(
      `UPDATE users
       SET credits = credits - $1,
           total_credits_used = total_credits_used + $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING credits`,
      [amount, userId]
    );

    const balanceAfter = updateResult.rows[0].credits;

    // ✅ INSERT VERIFICATION: Record transaction and verify it succeeded
    const insertResult = await client.query(
      `INSERT INTO credit_transactions
       (user_id, type, amount, balance_before, balance_after, reference_type, reference_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [userId, 'deduct', -amount, balanceBefore, balanceAfter, referenceType, referenceId, description]
    );

    // ✅ CRITICAL: Verify INSERT succeeded
    if (!insertResult.rowCount || insertResult.rowCount === 0) {
      throw new Error('Failed to record credit transaction - INSERT returned 0 rows');
    }

    await client.query('COMMIT');

    console.log(JSON.stringify({
      event: 'credit_deduction',
      userId,
      amount,
      balanceBefore,
      balanceAfter,
      referenceType,
      referenceId,
      description,
      transactionId: insertResult.rows[0].id,
      success: true,
      timestamp: new Date().toISOString()
    }));

    return { success: true, balanceAfter };

  } catch (error) {
    // ✅ SAFE ROLLBACK: Wrap in try-catch to prevent double-throw
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(`❌ [CreditService] ROLLBACK failed for user ${userId}:`, rollbackError);
    }

    console.error(JSON.stringify({
      event: 'credit_deduction_failed',
      userId,
      amount,
      referenceType,
      referenceId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }));

    return {
      success: false,
      balanceAfter: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    client.release();
  }
}

/**
 * Add credits to a user (admin operation)
 * Supports both adding (positive amount) and deducting (negative amount for admin_deduct)
 */
export async function addCredits(
  userId: number,
  amount: number,
  type: 'purchase' | 'admin_add' | 'bonus' | 'registration' | 'admin_deduct',
  description: string,
  adminId?: number
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current balance
    const userResult = await client.query(
      'SELECT credits FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, balanceAfter: 0, error: 'User not found' };
    }

    const balanceBefore = userResult.rows[0].credits;

    // For admin_deduct, check if user has sufficient credits
    if (type === 'admin_deduct' && amount < 0) {
      if (balanceBefore < Math.abs(amount)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          balanceAfter: balanceBefore,
          error: `Insufficient credits (has: ${balanceBefore}, needs: ${Math.abs(amount)})`
        };
      }
    }

    // Add or deduct credits
    const updateResult = await client.query(
      `UPDATE users
       SET credits = credits + $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING credits`,
      [amount, userId]
    );

    const balanceAfter = updateResult.rows[0].credits;

    // ✅ INSERT VERIFICATION: Record transaction and verify it succeeded
    const insertResult = await client.query(
      `INSERT INTO credit_transactions
       (user_id, type, amount, balance_before, balance_after, description, created_by_admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, type, amount, balanceBefore, balanceAfter, description, adminId || null]
    );

    // ✅ CRITICAL: Verify INSERT succeeded
    if (!insertResult.rowCount || insertResult.rowCount === 0) {
      throw new Error('Failed to record credit add/deduct transaction - INSERT returned 0 rows');
    }

    await client.query('COMMIT');

    const action = amount > 0 ? 'Added' : 'Deducted';
    console.log(JSON.stringify({
      event: amount > 0 ? 'credit_add' : 'credit_admin_deduct',
      userId,
      amount,
      balanceBefore,
      balanceAfter,
      type,
      description,
      adminId,
      transactionId: insertResult.rows[0].id,
      success: true,
      timestamp: new Date().toISOString()
    }));

    return { success: true, balanceAfter };

  } catch (error) {
    // ✅ SAFE ROLLBACK: Wrap in try-catch to prevent double-throw
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(`❌ [CreditService] ROLLBACK failed for user ${userId}:`, rollbackError);
    }

    console.error(JSON.stringify({
      event: 'credit_add_failed',
      userId,
      amount,
      type,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }));

    return {
      success: false,
      balanceAfter: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    client.release();
  }
}

/**
 * Deduct credits with automatic retry on transient failures
 * Uses exponential backoff: 200ms, 400ms, 800ms
 */
export async function deductCreditsWithRetry(
  userId: number,
  amount: number,
  referenceType: string,
  referenceId: string,
  description: string,
  maxRetries: number = 3
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await deductCredits(userId, amount, referenceType, referenceId, description);

    // If successful or idempotent, return immediately
    if (result.success) {
      if (attempt > 1) {
        console.log(`✅ [CreditService] Deduction succeeded on attempt ${attempt}/${maxRetries}`);
      }
      return result;
    }

    // If insufficient credits, don't retry (not a transient error)
    if (result.error && result.error.includes('Insufficient credits')) {
      return result;
    }

    // If user not found, don't retry
    if (result.error && result.error.includes('User not found')) {
      return result;
    }

    // For other errors, retry with exponential backoff
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 100; // 200ms, 400ms, 800ms
      console.warn(`⏳ [CreditService] Retry attempt ${attempt}/${maxRetries} for user ${userId} in ${delay}ms`);
      console.warn(`   Error: ${result.error}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      console.error(`❌ [CreditService] Max retries (${maxRetries}) exceeded for user ${userId}`);
    }
  }

  return {
    success: false,
    balanceAfter: 0,
    error: `Max retries (${maxRetries}) exceeded`
  };
}

/**
 * Refund credits with automatic retry on transient failures
 * Uses exponential backoff: 200ms, 400ms, 800ms
 *
 * This prevents credit loss due to temporary database issues like:
 * - Connection timeouts
 * - Deadlocks
 * - Temporary unavailability
 */
export async function refundCreditsWithRetry(
  userId: number,
  amount: number,
  referenceType: string,
  referenceId: string,
  description: string,
  maxRetries: number = 3
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await refundCredits(userId, amount, referenceType, referenceId, description);

    // If successful or idempotent, return immediately
    if (result.success) {
      if (attempt > 1) {
        console.log(`✅ [CreditService] Refund succeeded on attempt ${attempt}/${maxRetries}`);
      }
      return result;
    }

    // If user not found, don't retry (not a transient error)
    if (result.error && result.error.includes('User not found')) {
      console.warn(`⚠️  [CreditService] User ${userId} not found, skipping refund retry`);
      return result;
    }

    // If already refunded (idempotent), return success
    if (result.error && result.error.includes('already processed')) {
      return result;
    }

    // For other errors (likely transient database issues), retry with exponential backoff
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 100; // 200ms, 400ms, 800ms
      console.warn(`⏳ [CreditService] Refund retry attempt ${attempt}/${maxRetries} for user ${userId} in ${delay}ms`);
      console.warn(`   Reference: ${referenceType}/${referenceId}`);
      console.warn(`   Error: ${result.error}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      console.error(`❌ [CreditService] Max refund retries (${maxRetries}) exceeded for user ${userId}`);
      console.error(`   Reference: ${referenceType}/${referenceId}`);
      console.error(`   Amount: ${amount} credits`);
      console.error(`   ⚠️  USER MAY HAVE LOST CREDITS - MANUAL INVESTIGATION REQUIRED`);
    }
  }

  return {
    success: false,
    balanceAfter: 0,
    error: `Max retries (${maxRetries}) exceeded - user may have lost ${amount} credits`
  };
}

/**
 * Get credit transaction history for a user
 */
export async function getCreditHistory(
  userId: number,
  limit: number = 50,
  offset: number = 0,
  type?: string
): Promise<{ transactions: CreditTransaction[], totalCount: number }> {
  try {
    // Build WHERE clause
    let whereClause = `WHERE user_id = $1`;
    const params: any[] = [userId];

    // Add type filter if provided
    if (type && type !== 'all') {
      if (type === 'credit_add') {
        // Group admin_add, bonus, purchase, and registration together as "เติมเครดิต"
        whereClause += ` AND type IN ('admin_add', 'bonus', 'purchase', 'registration')`;
      } else if (type === 'credit_deduct') {
        // Group deduct and admin_deduct together as "หักเครดิต"
        whereClause += ` AND type IN ('deduct', 'admin_deduct')`;
      } else {
        whereClause += ` AND type = $${params.length + 1}`;
        params.push(type);
      }
    }

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM credit_transactions ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].total);

    // Get paginated data
    let dataQuery = `SELECT
        id,
        user_id as "userId",
        type,
        amount,
        balance_before as "balanceBefore",
        balance_after as "balanceAfter",
        reference_type as "referenceType",
        reference_id as "referenceId",
        description,
        metadata,
        created_by_admin_id as "createdByAdminId",
        created_at as "createdAt"
       FROM credit_transactions
       ${whereClause}
       ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const dataParams = [...params, limit, offset];
    const result = await pool.query(dataQuery, dataParams);

    return {
      transactions: result.rows,
      totalCount
    };
  } catch (error) {
    console.error(`❌ [CreditService] Failed to get history for user ${userId}:`, error);
    return { transactions: [], totalCount: 0 };
  }
}

/**
 * Get transaction by reference (e.g., find transaction for a specific task)
 */
export async function getTransactionByReference(
  referenceType: string,
  referenceId: string
): Promise<CreditTransaction | null> {
  try {
    const result = await pool.query(
      `SELECT
        id,
        user_id as "userId",
        type,
        amount,
        balance_before as "balanceBefore",
        balance_after as "balanceAfter",
        reference_type as "referenceType",
        reference_id as "referenceId",
        description,
        metadata,
        created_by_admin_id as "createdByAdminId",
        created_at as "createdAt"
       FROM credit_transactions
       WHERE reference_type = $1 AND reference_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [referenceType, referenceId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`❌ [CreditService] Failed to get transaction:`, error);
    return null;
  }
}

/**
 * Check if a task has already been refunded (prevent double refund)
 */
export async function hasBeenRefunded(
  referenceType: string,
  referenceId: string
): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM credit_transactions
       WHERE reference_type = $1
       AND reference_id = $2
       AND type = 'refund'`,
      [referenceType, referenceId]
    );

    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error(`❌ [CreditService] Failed to check refund status:`, error);
    return false;
  }
}

/**
 * Update credit transaction with KIE Task ID
 * Call this after getting KIE task ID from API
 * Updates both reference_id and metadata.kie_task_id
 */
export async function updateKieTaskId(
  userId: number,
  kieTaskId: string,
  transactionType: 'deduct' | 'refund' = 'deduct'
): Promise<boolean> {
  try {
    // Find most recent transaction for this user with empty reference_id
    const result = await pool.query(
      `UPDATE credit_transactions
       SET reference_id = $1,
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{kie_task_id}',
             $2::jsonb
           )
       WHERE user_id = $3
       AND type = $4
       AND (reference_id = '' OR reference_id IS NULL)
       AND reference_type = 'video_task'
       AND id = (
         SELECT id FROM credit_transactions
         WHERE user_id = $3
         AND type = $4
         AND (reference_id = '' OR reference_id IS NULL)
         AND reference_type = 'video_task'
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [kieTaskId, JSON.stringify(kieTaskId), userId, transactionType]
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(`🏷️  [CreditService] Updated transaction for user ${userId}`);
      console.log(`   KIE Task ID: ${kieTaskId}`);
      return true;
    }

    console.warn(`⚠️  [CreditService] No pending transaction found for user ${userId}`);
    return false;
  } catch (error) {
    console.error(`❌ [CreditService] Failed to update KIE Task ID:`, error);
    return false;
  }
}

export default {
  refundCredits,
  refundCreditsWithRetry,
  deductCredits,
  deductCreditsWithRetry,
  addCredits,
  getCreditHistory,
  getTransactionByReference,
  hasBeenRefunded,
  updateKieTaskId
};
