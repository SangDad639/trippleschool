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

  // Build multipart form data
  const formData = new FormData();
  // Convert Node Buffer → Uint8Array (BlobPart compatible)
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
  formData.append('image', blob, 'slip.jpg');
  formData.append('checkDuplicate', 'true');
  // Ask Thunder to populate `matchedAccount` in the response (cross-reference
  // the slip's receiver against Thunder's known account database).
  formData.append('matchAccount', 'true');

  console.log('[Thunder] Sending slip to', `${baseUrl}/verify/bank`);
  const response = await fetch(`${baseUrl}/verify/bank`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

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
