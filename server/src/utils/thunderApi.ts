/**
 * Thunder API client for slip verification.
 * Verifies bank transfer slips and returns parsed slip data.
 *
 * Docs: https://api.thunder.in.th/v2
 */

export interface ThunderMatchedAccount {
  bank: {
    nameTh: string;
    nameEn: string;
    code: string;
    shortCode: string;
  };
  nameTh: string;
  nameEn: string;
  type: 'PERSONAL' | 'JURISTIC';
  bankNumber: string;
}

export interface ThunderRawSlip {
  payload: string;
  transRef: string;
  date: string;
  countryCode: string;
  amount: {
    amount: number;
    local: { amount: number; currency: string };
  };
  fee: number;
  ref1: string;
  ref2: string;
  ref3: string;
  sender: any;
  receiver: any;
}

export interface ThunderVerifyData {
  remark?: string;
  isDuplicate: boolean;
  matchedAccount: ThunderMatchedAccount | null;
  amountInOrder?: number;
  amountInSlip: number;
  isAmountMatched?: boolean;
  rawSlip: ThunderRawSlip;
}

export interface ThunderVerifyResponse {
  success: true;
  data: ThunderVerifyData;
  message: string;
}

export interface ThunderErrorResponse {
  success: false;
  error: { code: string; message: string };
}

export class ThunderError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ThunderError';
  }
}

/**
 * Verify a bank slip image via Thunder API.
 * @param imageBuffer - Slip image binary buffer
 * @param mimeType - Image mime type (e.g. 'image/jpeg')
 * @throws ThunderError on API failure
 */
export async function verifySlipImage(
  imageBuffer: Buffer,
  mimeType: string
): Promise<ThunderVerifyData> {
  const apiKey = process.env.THUNDER_API_KEY;
  const baseUrl = process.env.THUNDER_API_URL || 'https://api.thunder.in.th/v2';

  if (!apiKey) {
    throw new ThunderError('CONFIG_ERROR', 'THUNDER_API_KEY not configured');
  }

  console.log('[Thunder] Sending slip to', `${baseUrl}/verify/bank`);

  // One fetch attempt with a 15s timeout. A fresh FormData/Blob is built per
  // attempt because fetch consumes the body stream (can't be reused on retry).
  const attempt = async (): Promise<Awaited<ReturnType<typeof fetch>>> => {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
    formData.append('image', blob, 'slip.jpg');
    formData.append('checkDuplicate', 'true');
    // Ask Thunder to populate `matchedAccount` (cross-reference the slip's
    // receiver against Thunder's known account database).
    formData.append('matchAccount', 'true');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      return await fetch(`${baseUrl}/verify/bank`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // Retry once on network error / timeout. A real HTTP error response is NOT
  // retried here — it's handled below.
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await attempt();
  } catch {
    try {
      response = await attempt();
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      throw new ThunderError(
        aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        aborted
          ? 'หมดเวลาเชื่อมต่อระบบตรวจสลิป กรุณาลองใหม่อีกครั้ง'
          : 'เชื่อมต่อระบบตรวจสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
      );
    }
  }

  const result: any = await response.json();
  console.log('[Thunder] Response:', JSON.stringify(result).substring(0, 500));

  if (!response.ok || result.success === false) {
    const code = result.error?.code || result.message || 'UNKNOWN_ERROR';
    const message = result.error?.message || result.message || 'Thunder verification failed';
    throw new ThunderError(code, message);
  }

  if (!result.data) {
    throw new ThunderError('INVALID_RESPONSE', 'No data in Thunder response');
  }

  return result.data;
}
