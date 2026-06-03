/**
 * Recovery Job for Stuck Video Generation Tasks
 *
 * Runs at server startup and every 2 minutes to:
 * 1. Recover Vidgo tasks that were generating when server restarted
 * 2. Check if external tasks have completed
 * 3. Auto-restart queue for users with recovered items
 */

import cron from 'node-cron';
import queueRunner from '../lib/queue-runner.js';

let isRunning = false;

async function runRecovery(): Promise<void> {
  if (isRunning) {
    console.log('🔄 [Recovery] Already running, skipping...');
    return;
  }

  isRunning = true;
  console.log('🔄 [Recovery] Starting recovery check...');

  try {
    const result = await queueRunner.recoverStuckVidgoTasks();

    if (result.checked > 0) {
      console.log(`🔄 [Recovery] Checked: ${result.checked}, Recovered: ${result.recovered}, Failed: ${result.failed}`);
    }

    if (result.recovered > 0) {
      console.log(`🔄 [Recovery] ${result.recovered} items recovered and auto-retrying`);
    }
  } catch (error) {
    console.error('🔄 [Recovery] Error:', error);
  } finally {
    isRunning = false;
  }
}

export function startRecoveryJob(): void {
  console.log('📅 Recovery Job scheduled');
  console.log('   Schedule: Every 2 minutes');
  console.log('   Action: Recover stuck Vidgo tasks');

  // Run immediately on startup (after short delay to let server fully start)
  setTimeout(() => {
    console.log('🔄 [Recovery] Running initial recovery check on startup...');
    runRecovery();
  }, 3000);

  // Run every 2 minutes for faster recovery
  cron.schedule('*/2 * * * *', () => {
    runRecovery();
  }, {
    timezone: 'Asia/Bangkok'
  });
}

export default { startRecoveryJob };
