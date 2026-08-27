// Triple School API Client - Scheduler focused

class ApiClient {
  private token: string | null = null;
  private _cachedApiUrl: string | null = null;

  constructor() {
    this.token = localStorage.getItem('auth_token');
  }

  private get apiUrl(): string {
    if (this._cachedApiUrl) {
      return this._cachedApiUrl;
    }

    if (import.meta.env.VITE_API_URL) {
      this._cachedApiUrl = import.meta.env.VITE_API_URL as string;
      return this._cachedApiUrl;
    }

    // Use relative URL so Vite proxy handles routing in dev
    this._cachedApiUrl = '';
    return this._cachedApiUrl;
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
  }

  getToken(): string {
    return this.token ?? '';
  }

  getApiUrl(): string {
    return this.apiUrl;
  }

  /**
   * Resolve a media path served by the backend (S3-proxy images: course
   * thumbnails, payment slips) to a fully-qualified URL.
   *
   * Stored values are relative (e.g. "/api/courses/thumbnails/..."). In prod the
   * FE and API are on different origins (VITE_API_URL), so an <img src> using the
   * raw relative path would hit the FE origin and 404. Prepend the API base for
   * relative "/..." paths; pass through values that are already absolute.
   */
  mediaUrl(path?: string | null, variant?: 'card' | 'hero'): string {
    if (!path) return '';
    let out = /^https?:\/\//i.test(path) ? path : path.startsWith('/') ? `${this.apiUrl}${path}` : path;
    // Course thumbnails have pre-generated webp variants (?v=card ~40KB,
    // ?v=hero ~150KB vs 2MB originals). The proxy falls back to the original
    // when a variant is missing, so this is always safe to request.
    if (variant && out.includes('/api/courses/thumbnails/')) {
      // r= is a cache revision: variants are cached immutable for a year, so
      // bump it whenever regenerated files must replace stale browser caches
      // (r=2: first batch had corrupt RIFF headers).
      out += (out.includes('?') ? '&' : '?') + `v=${variant}&r=2`;
    }
    return out;
  }

  /**
   * Download a file via backend streaming proxy.
   * Bypasses browser CORS/cross-origin issues for Dropbox/KIE/S3 URLs.
   * Auto-triggers browser download with correct filename.
   */
  async downloadViaProxy(url: string, filename: string): Promise<void> {
    const proxyUrl = `${this.apiUrl}/api/content-history/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
    const response = await fetch(proxyUrl, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(errBody.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }

  private async request(endpoint: string, options: RequestInit = {}, retries = 3, timeout = 30000) {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };

    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${this.apiUrl}${endpoint}`, {
          ...options,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
          // Callers need the status to tell a real auth failure (401/404 → the
          // session is genuinely dead) from a transient one (network drop, 5xx).
          // Without it, a momentary hiccup used to look identical to a bad token
          // and cost the user their session / bounced them off the page.
          const withStatus = <T extends Error>(e: T): T => {
            (e as any).status = response.status;
            return e;
          };

          // Handle pending approval - throw with pendingApproval flag
          if (response.status === 403 && errorData.pendingApproval) {
            const error = new Error(errorData.error || 'Account pending approval');
            (error as any).pendingApproval = true;
            throw withStatus(error);
          }

          // Subscription required — dispatch an event so the app-level listener
          // can perform SPA navigation (no hard reload). The listener dedups
          // bursts of parallel 403s so a single redirect fires per visit to a
          // protected route. Hard reloads here used to cause a refresh loop on
          // slow devices: any pending protected fetch that 403'd after the
          // reload would trigger another reload, ad infinitum.
          if (response.status === 403 && (errorData.code === 'SUBSCRIPTION_EXPIRED' || errorData.code === 'NO_SUBSCRIPTION')) {
            window.dispatchEvent(new CustomEvent('subscription:required', {
              detail: { code: errorData.code, message: errorData.error },
            }));
            throw withStatus(new Error(errorData.error || 'กรุณาสมัครสมาชิก'));
          }

          // Handle duplicate request - throw with duplicate flag for silent handling
          if (response.status === 409 && errorData.duplicate) {
            const error = new Error(errorData.error || 'Duplicate request');
            (error as any).duplicate = true;
            throw withStatus(error);
          }

          if ((response.status >= 500 || response.status === 429) && attempt < retries) {
            const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }

          const err = new Error(errorData.error || `HTTP ${response.status}`);
          (err as any).errorCode = errorData.errorCode;
          throw withStatus(err);
        }

        return response.json();

      } catch (error) {
        lastError = error as Error;

        if (attempt < retries && (error instanceof TypeError || (error as Error).name === 'AbortError')) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  // ============================================
  // Auth endpoints
  // ============================================

  async register(email: string, password: string, refcode?: string) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, refcode }),
    });
  }

  async login(email: string, password: string) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async googleLogin(credential: string, refcode?: string) {
    return this.request('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential, refcode }),
    });
  }

  async getCurrentUser() {
    return this.request('/api/auth/me');
  }

  // ============================================
  // Scheduler Channels
  // ============================================

  async getSchedulerChannels() {
    return this.request('/api/scheduler/channels');
  }

  async getSchedulerChannel(id: number) {
    return this.request(`/api/scheduler/channels/${id}`);
  }

  async createSchedulerChannel(data: {
    name: string;
    platform?: string;
    duration?: string;
    aspect_ratio?: string;
    prompt_template?: string;
    variables?: Array<{ name: string; values: Array<{ id: string; value: string; status: string }> }>;
    caption_language?: string;
    custom_hashtags?: string;
    timezone?: string;
    posts_per_day?: number;
    channel_highlight?: string;
    example_prompts?: string[];
  }) {
    return this.request('/api/scheduler/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSchedulerChannel(id: number, data: Record<string, any>) {
    return this.request(`/api/scheduler/channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateChannelVariables(id: number, variables: any[]) {
    return this.request(`/api/scheduler/channels/${id}/variables`, {
      method: 'PATCH',
      body: JSON.stringify({ variables }),
    });
  }

  async deleteSchedulerChannel(id: number) {
    return this.request(`/api/scheduler/channels/${id}`, {
      method: 'DELETE',
    });
  }

  async getChannelStock(id: number) {
    return this.request(`/api/scheduler/channels/${id}/stock`);
  }

  async uploadWatermarkImage(channelId: number, file: File): Promise<{ imageUrl: string; imagePath: string }> {
    const formData = new FormData();
    formData.append('image', file);
    return this.request(`/api/scheduler/channels/${channelId}/watermark-image`, {
      method: 'POST',
      body: formData,
    });
  }

  async deleteWatermarkImage(channelId: number): Promise<{ success: boolean }> {
    return this.request(`/api/scheduler/channels/${channelId}/watermark-image`, {
      method: 'DELETE',
    });
  }

  // Channel Example Prompts
  async addChannelExample(channelId: number, promptText: string) {
    return this.request(`/api/scheduler/channels/${channelId}/examples`, {
      method: 'POST',
      body: JSON.stringify({ prompt_text: promptText }),
    });
  }

  async updateChannelExample(channelId: number, exampleId: number, promptText: string) {
    return this.request(`/api/scheduler/channels/${channelId}/examples/${exampleId}`, {
      method: 'PUT',
      body: JSON.stringify({ prompt_text: promptText }),
    });
  }

  async deleteChannelExample(channelId: number, exampleId: number) {
    return this.request(`/api/scheduler/channels/${channelId}/examples/${exampleId}`, {
      method: 'DELETE',
    });
  }

  // AI Prompt Generation
  async generateChannelSystemPrompt(channelId: number): Promise<{ system_prompt: string; generated_at: string }> {
    return this.request(`/api/scheduler/channels/${channelId}/generate-system-prompt`, {
      method: 'POST',
    });
  }

  async generateChannelInspiredPrompt(channelId: number, examplePromptId: number): Promise<{ generated_prompt: string }> {
    return this.request(`/api/scheduler/channels/${channelId}/generate-inspired-prompt`, {
      method: 'POST',
      body: JSON.stringify({ example_prompt_id: examplePromptId }),
    });
  }

  async generateVariableValues(
    systemPrompt: string,
    variableName: string,
    count: number,
    extra?: { image_url?: string; template_context?: string }
  ): Promise<{ values: string[] }> {
    return this.request('/api/scheduler/channels/generate-variable-values', {
      method: 'POST',
      body: JSON.stringify({
        system_prompt: systemPrompt,
        variable_name: variableName,
        count,
        image_url: extra?.image_url,
        template_context: extra?.template_context,
      }),
    }, 1, 120000);
  }

  // ============================================
  // Schedule Queue
  // ============================================

  async getScheduleQueue(params?: {
    channel_id?: number;
    status?: string;
    limit?: number;
    offset?: number;
    include_generate_only?: boolean;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.channel_id) searchParams.append('channel_id', params.channel_id.toString());
    if (params?.status) searchParams.append('status', params.status);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.include_generate_only) searchParams.append('include_generate_only', 'true');

    const queryString = searchParams.toString();
    return this.request(`/api/scheduler/queue${queryString ? `?${queryString}` : ''}`);
  }

  async getScheduleQueueByDate(params?: {
    channel_id?: number;
    start_date?: string;
    end_date?: string;
    timezone?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.channel_id) searchParams.append('channel_id', params.channel_id.toString());
    if (params?.start_date) searchParams.append('start_date', params.start_date);
    if (params?.end_date) searchParams.append('end_date', params.end_date);
    if (params?.timezone) searchParams.append('timezone', params.timezone);

    const queryString = searchParams.toString();
    return this.request(`/api/scheduler/queue/by-date${queryString ? `?${queryString}` : ''}`);
  }

  async createScheduleQueueItems(items: Array<{
    channel_id: number;
    scheduled_time: string;
    prompt: string;
    variable_values?: Record<string, string>;
    platform?: string;
    duration?: string;
    aspect_ratio?: string;
  }>, options?: { autoStart?: boolean }) {
    return this.request('/api/scheduler/queue', {
      method: 'POST',
      body: JSON.stringify({ items, autoStart: options?.autoStart ?? false }),
    });
  }

  async updateScheduleQueueItem(id: number, data: Partial<{
    scheduled_time: string;
    prompt: string;
    variable_values: Record<string, string>;
    status: string;
    video_url: string;
    dropbox_path: string;
    error: string;
    platform: string;
    duration: string;
    aspect_ratio: string;
  }>) {
    return this.request(`/api/scheduler/queue/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteScheduleQueueItem(id: number) {
    return this.request(`/api/scheduler/queue/${id}`, {
      method: 'DELETE',
    });
  }

  async retryScheduleQueueItem(id: number) {
    return this.request(`/api/scheduler/queue/retry/${id}`, {
      method: 'POST',
    });
  }

  async retryAllFailedItems(channelId: number): Promise<{ success: boolean; count: number; message: string }> {
    return this.request(`/api/scheduler/queue/retry-all-failed`, {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId }),
    });
  }

  async enableUnlimitedRetry(id: number): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/scheduler/queue/${id}/unlimited-retry`, {
      method: 'POST',
    });
  }

  async stopItemRetry(id: number): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/scheduler/queue/${id}/stop-retry`, {
      method: 'POST',
    });
  }

  async getScheduleQueueStats(channelId?: number) {
    const queryString = channelId ? `?channel_id=${channelId}` : '';
    return this.request(`/api/scheduler/queue/stats${queryString}`);
  }

  async getScheduleQueueStatsByChannel(): Promise<Record<string, { pending: number; queued: number; generating: number; captioning: number; scheduling: number; done: number; failed: number }>> {
    return this.request(`/api/scheduler/queue/stats-by-channel`);
  }

  async generateSingleQueueItem(id: number, generateOnly?: boolean, extendPrompt?: string) {
    return this.request(`/api/scheduler/queue/generate/${id}`, {
      method: 'POST',
      body: JSON.stringify({ generate_only: generateOnly, extend_prompt: extendPrompt }),
    });
  }

  async generateToHistory(channelId: number, count: number, prompt?: string, promptMode?: string, prompts?: (string | null)[], templateIds?: (string | null)[], extendPrompts?: (string | null)[], requestId?: string) {
    return this.request('/api/scheduler/queue/generate-to-history', {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId, count, prompt, prompt_mode: promptMode, prompts, template_ids: templateIds, extend_prompts: extendPrompts, request_id: requestId }),
    });
  }

  async getQueueItemsByIds(ids: number[]) {
    return this.request('/api/scheduler/queue/by-ids', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  async getActiveGens(channelId: number): Promise<{ items: any[] }> {
    return this.request(`/api/scheduler/queue/active-gens/${channelId}`);
  }

  async postQueueItem(id: number) {
    return this.request(`/api/scheduler/queue/post/${id}`, {
      method: 'POST',
    });
  }

  // Queue Runner
  async startSchedulerQueue(force = false, channelId?: number, dates?: string[], timezone?: string, templateId?: string, templateMode?: string, generateOnly?: boolean, requestId?: string, extendPrompts?: Record<number, string>) {
    return this.request('/api/scheduler/queue/run', {
      method: 'POST',
      body: JSON.stringify({ force, channel_id: channelId, dates, timezone, template_id: templateId, template_mode: templateMode, generate_only: generateOnly, request_id: requestId, extend_prompts: extendPrompts }),
    });
  }

  async stopSchedulerQueue() {
    return this.request('/api/scheduler/queue/stop', {
      method: 'POST',
    });
  }

  async getSchedulerRunnerStatus() {
    return this.request('/api/scheduler/queue/runner-status');
  }

  async getSchedulerActivityLogs(limit = 50) {
    return this.request(`/api/scheduler/queue/activity-logs?limit=${limit}`);
  }

  async clearSchedulerActivityLogs() {
    return this.request('/api/scheduler/queue/activity-logs', {
      method: 'DELETE',
    });
  }

  async getQueueItemLogs(queueItemId: number) {
    return this.request(`/api/scheduler/queue/${queueItemId}/logs`);
  }

  async bulkGenerateSchedulerQueue(channelId: number, dates: string[], timeSlots: string[]) {
    return this.request('/api/scheduler/queue/bulk-generate', {
      method: 'POST',
      body: JSON.stringify({
        channel_id: channelId,
        dates,
        time_slots: timeSlots,
      }),
    }, 3, 180000);
  }

  // ============================================
  // Dashboard Stats
  // ============================================

  async getDashboardStats(days: number = 7, channelId?: number) {
    const params = new URLSearchParams({ days: days.toString() });
    if (channelId) params.set('channel_id', channelId.toString());
    return this.request(`/api/scheduler/queue/dashboard-stats?${params}`);
  }

  // ============================================
  // Time Presets
  // ============================================

  async getTimePresets() {
    return this.request('/api/scheduler/time-presets');
  }

  async createTimePreset(name: string, times: string[]) {
    return this.request('/api/scheduler/time-presets', {
      method: 'POST',
      body: JSON.stringify({ name, times }),
    });
  }

  async deleteTimePreset(id: number) {
    return this.request(`/api/scheduler/time-presets/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Scheduler Drafts
  // ============================================

  async getSchedulerDrafts(channelId: number) {
    return this.request(`/api/scheduler/drafts/${channelId}`);
  }

  async saveSchedulerDraft(data: {
    channel_id: number;
    scheduled_date: string;
    time_slot: string;
    prompt: string;
    is_ai_generated?: boolean;
  }) {
    return this.request('/api/scheduler/drafts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteSchedulerDraft(channelId: number, date: string, time: string) {
    const urlSafeTime = time.replace(':', '-');
    return this.request(`/api/scheduler/drafts/${channelId}/${date}/${urlSafeTime}`, {
      method: 'DELETE',
    });
  }

  async deleteAllSchedulerDrafts(channelId: number) {
    return this.request(`/api/scheduler/drafts/${channelId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Gen Task Drafts (for "สร้างคลิป" dialog)
  // ============================================

  async getGenTaskDrafts(channelId: number): Promise<{ tasks: Array<{ id: number; template_id: string; custom_prompt: string }> }> {
    return this.request(`/api/scheduler/gen-tasks/${channelId}`);
  }

  async saveGenTaskDrafts(channelId: number, tasks: Array<{ templateId: string; customPrompt: string; ai_model?: string }>): Promise<{ success: boolean; count: number }> {
    return this.request(`/api/scheduler/gen-tasks/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify({ tasks }),
    });
  }

  async deleteGenTaskDrafts(channelId: number): Promise<{ success: boolean; deletedCount: number }> {
    return this.request(`/api/scheduler/gen-tasks/${channelId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Prompt Templates
  // ============================================

  async getPromptTemplates(params?: {
    platform?: string;
    search?: string;
    featured?: boolean;
    page?: number;
    limit?: number;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.platform) searchParams.append('platform', params.platform);
    if (params?.search) searchParams.append('search', params.search);
    if (params?.featured) searchParams.append('featured', 'true');
    if (params?.page) searchParams.append('page', params.page.toString());
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    const queryString = searchParams.toString();
    return this.request(`/api/prompt-templates${queryString ? `?${queryString}` : ''}`);
  }

  async getPromptTemplate(slug: string) {
    return this.request(`/api/prompt-templates/${slug}`);
  }

  async getMyFavoritePrompts() {
    return this.request('/api/prompt-templates/user/favorites');
  }

  async togglePromptFavorite(id: number) {
    return this.request(`/api/prompt-templates/${id}/favorite`, {
      method: 'POST',
    });
  }

  async applyPromptToChannel(promptId: number, channelId: number) {
    return this.request(`/api/prompt-templates/${promptId}/apply-to-channel/${channelId}`, {
      method: 'POST',
    });
  }

  async checkPromptFavorites(ids: number[]) {
    return this.request(`/api/prompt-templates/user/check-favorites?ids=${ids.join(',')}`);
  }

  // Custom Prompts
  async getCustomPrompts() {
    return this.request('/api/prompt-templates/user/custom');
  }

  async createCustomPrompt(data: { name: string; prompt_template: string; variables?: any[]; platform?: string; description?: string; youtube_url?: string }) {
    return this.request('/api/prompt-templates/user/custom', { method: 'POST', body: JSON.stringify(data) });
  }

  async updateCustomPrompt(id: number, data: { name: string; prompt_template: string; variables?: any[]; platform?: string; description?: string; youtube_url?: string }) {
    return this.request(`/api/prompt-templates/user/custom/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteCustomPrompt(id: number) {
    return this.request(`/api/prompt-templates/user/custom/${id}`, { method: 'DELETE' });
  }

  // ============================================
  // Prompt Direct (Jobs pattern — ตาม Viral Template)
  // ============================================

  async createPromptDirectJob(data: { prompt_library_id: number; channel_id: number | null; number_of_videos: number; language?: string }) {
    return this.request('/api/prompt-direct/jobs', { method: 'POST', body: JSON.stringify(data) });
  }

  async getPromptDirectJobs(promptLibraryId?: number) {
    const qs = promptLibraryId ? `?prompt_library_id=${promptLibraryId}` : '';
    return this.request(`/api/prompt-direct/jobs${qs}`);
  }

  async getPromptDirectJobStatus(jobId: number) {
    return this.request(`/api/prompt-direct/jobs/${jobId}/status`);
  }

  async generatePromptDirectTask(jobId: number, taskId: number) {
    return this.request(`/api/prompt-direct/jobs/${jobId}/tasks/${taskId}/generate`, { method: 'POST' });
  }

  async generateAllPromptDirectTasks(jobId: number) {
    return this.request(`/api/prompt-direct/jobs/${jobId}/generate-all`, { method: 'POST' });
  }

  async deletePromptDirectJob(jobId: number) {
    return this.request(`/api/prompt-direct/jobs/${jobId}`, { method: 'DELETE' });
  }

  async updatePromptDirectTaskVariables(jobId: number, taskId: number, variables_used: Record<string, string>) {
    return this.request(`/api/prompt-direct/jobs/${jobId}/tasks/${taskId}/variables`, {
      method: 'PATCH',
      body: JSON.stringify({ variables_used }),
    });
  }

  // ============================================
  // Scheduler Migration (admin)
  // ============================================

  async runSchedulerMigration() {
    return this.request('/api/scheduler/migrate');
  }

  // ============================================
  // Subscription
  // ============================================

  async getPaymentSlip(): Promise<{ slipUrl: string | null; uploadedAt: string | null; plan: string | null }> {
    return this.request('/api/subscription/payment-slip');
  }

  async uploadPaymentSlip(file: File, plan: 'monthly' | 'yearly'): Promise<{ success: boolean; url: string }> {
    const formData = new FormData();
    formData.append('slip', file);
    formData.append('plan', plan);
    return this.request('/api/subscription/upload-slip', {
      method: 'POST',
      body: formData,
    });
  }

  async verifyAndApproveSlip(file: File, plan: 'monthly' | 'yearly'): Promise<{
    success: boolean;
    expiresAt?: string;
    plan?: string;
    commissionCreated?: boolean;
    transRef?: string;
    error?: string;
    errorCode?: string;
  }> {
    const formData = new FormData();
    formData.append('slip', file);
    formData.append('plan', plan);
    return this.request('/api/subscription/v2/verify-and-approve', {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Public — fetch authoritative subscription pricing from the backend so the
   * FE doesn't have to hardcode amounts. Mirrors server/src/config/pricing.ts.
   * @deprecated — use getSubscriptionPlans() which supports dynamic plans.
   */
  async getSubscriptionPricing(): Promise<{
    vatRate: number;
    monthly: { subtotal: number; vat: number; total: number; days: number; centsTotal: number };
    yearly:  { subtotal: number; vat: number; total: number; days: number; centsTotal: number };
  }> {
    return this.request('/api/subscription/pricing');
  }

  /**
   * Public — list every active subscription plan (admin-managed via /admin/packages).
   * Order: display_order ASC, id ASC.
   *
   * Note: admin_alt_prices and tier_id are returned to all clients but the
   * Landing/Subscription pages only render the default subtotal+total. Admin
   * UI is the only consumer that surfaces the alt-price list.
   */
  async getSubscriptionPlans(): Promise<{
    vatRate: number;
    plans: Array<{
      id: number;
      slug: string;
      name: string;
      name_th: string | null;
      subtotal: number;
      vat: number;
      total: number;
      centsTotal: number;
      days: number;
      commission_percent: number | null;
      is_active: boolean;
      display_order: number;
      description: string | null;
      features: string[];
      admin_alt_prices: Array<{ label: string; label_th?: string; subtotal: number }>;
      admin_alt_prices_computed: Array<{ label: string; label_th?: string; subtotal: number; vat: number; total: number }>;
      tier_id: number | null;
      admin_only: boolean;
    }>;
  }> {
    return this.request('/api/subscription/plans');
  }

  // ========== Admin: Subscription Packages CRUD ==========
  /** Admin — list ALL packages (active + inactive + admin_only). Use this
   *  in admin UI when you need to surface hidden plans like Premium. The
   *  shape mirrors `getSubscriptionPlans().plans` but the wrapper key is
   *  `packages` instead of `plans`. */
  async getAdminPackages(): Promise<{
    packages: Array<{
      id: number;
      slug: string;
      name: string;
      name_th: string | null;
      subtotal: number;
      vat: number;
      total: number;
      centsTotal: number;
      days: number;
      commission_percent: number | null;
      is_active: boolean;
      display_order: number;
      description: string | null;
      features: string[];
      admin_alt_prices: Array<{ label: string; label_th?: string; subtotal: number }>;
      admin_alt_prices_computed: Array<{ label: string; label_th?: string; subtotal: number; vat: number; total: number }>;
      tier_id: number | null;
      admin_only: boolean;
    }>;
  }> {
    return this.request('/api/admin/packages');
  }
  async createPackage(data: any) {
    return this.request('/api/admin/packages', { method: 'POST', body: JSON.stringify(data) });
  }
  async updatePackage(id: number, data: any) {
    return this.request(`/api/admin/packages/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async deactivatePackage(id: number) {
    return this.request(`/api/admin/packages/${id}`, { method: 'DELETE' });
  }

  // ========== Admin: Per-(user × plan) commission overrides ==========
  // Matrix CRUD. The list endpoint is admin-readable; PUT/DELETE are super-admin
  // only on the server. Returns `{ overrides: [] }` on pre-migration DBs.
  async getUserCommissionOverrides(userId: number) {
    return this.request(`/api/admin/users/${userId}/commissions`);
  }
  async setUserCommissionOverride(userId: number, planId: number, commissionPercent: number) {
    return this.request(`/api/admin/users/${userId}/commissions/${planId}`, {
      method: 'PUT',
      body: JSON.stringify({ commission_percent: commissionPercent }),
    });
  }
  async deleteUserCommissionOverride(userId: number, planId: number) {
    return this.request(`/api/admin/users/${userId}/commissions/${planId}`, {
      method: 'DELETE',
    });
  }

  // ========== Admin: Affiliate Tiers CRUD (N-tier) ==========
  async getAdminTiersV2() { return this.request('/api/admin/tiers-v2'); }
  async createTier(data: any) {
    return this.request('/api/admin/tiers-v2', { method: 'POST', body: JSON.stringify(data) });
  }
  async updateTierV2(id: number, data: any) {
    return this.request(`/api/admin/tiers-v2/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async deleteTierV2(id: number) {
    return this.request(`/api/admin/tiers-v2/${id}`, { method: 'DELETE' });
  }

  async getSubscription() {
    return this.request('/api/subscription');
  }

  // ---------- Credits ----------

  async getCreditBalance(): Promise<{ credits: number; totalUsed: number }> {
    return this.request('/api/credits/balance');
  }

  async getCreditHistory(opts?: {
    limit?: number;
    offset?: number;
    type?: 'all' | 'credit_add' | 'credit_deduct';
  }): Promise<{
    items: CreditTransactionDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const q = new URLSearchParams();
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.offset) q.set('offset', String(opts.offset));
    if (opts?.type) q.set('type', opts.type);
    const qs = q.toString();
    return this.request(`/api/credits/history${qs ? '?' + qs : ''}`);
  }

  async getCreditPricing(): Promise<{
    generation: Record<string, unknown>;
    storyAgent: Record<string, unknown>;
  }> {
    return this.request('/api/credits/pricing');
  }

  async getCreditPackages(): Promise<{
    items: Array<{
      slug: string;
      name: string;
      name_th: string | null;
      credits: number;
      price_thb: number;
      description: string | null;
    }>;
  }> {
    return this.request('/api/credit-purchase/packages');
  }

  async getMyCreditPurchases(): Promise<{
    items: Array<{
      id: number;
      package_slug: string;
      credits: number;
      amount_thb: string;
      status: string;
      created_at: string;
    }>;
  }> {
    return this.request('/api/credit-purchase/my-purchases');
  }

  async creditPurchaseVerifyAndApprove(formData: FormData): Promise<unknown> {
    const url = `${this.apiUrl}/api/credit-purchase/verify-and-approve`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    return body;
  }

  async createCheckoutSession(planType: 'monthly' | 'yearly') {
    return this.request('/api/subscription/checkout', {
      method: 'POST',
      body: JSON.stringify({ planType }),
    });
  }

  async verifyCheckoutSession(sessionId: string) {
    return this.request('/api/subscription/verify-session', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  async changePlan(planType: 'monthly' | 'yearly') {
    return this.request('/api/subscription/change-plan', {
      method: 'POST',
      body: JSON.stringify({ planType }),
    });
  }

  async changePlanPortal(planType: 'monthly' | 'yearly') {
    return this.request('/api/subscription/change-plan-portal', {
      method: 'POST',
      body: JSON.stringify({ planType }),
    });
  }

  async cancelSubscription() {
    return this.request('/api/subscription/cancel', {
      method: 'POST',
    });
  }

  async reactivateSubscription() {
    return this.request('/api/subscription/reactivate', {
      method: 'POST',
    });
  }

  async getBillingPortalUrl() {
    return this.request('/api/subscription/portal', {
      method: 'POST',
    });
  }

  async getSubscriptionNotifications(): Promise<{
    notifications: Array<{
      id: number;
      notification_type: 'expiring_7d' | 'expiring_3d' | 'expiring_1d';
      expires_at: string;
      sent_at: string;
      read_at: string | null;
    }>;
  }> {
    return this.request('/api/subscription/notifications');
  }

  async markNotificationRead(id: number) {
    return this.request(`/api/subscription/notifications/${id}/read`, {
      method: 'PATCH',
    });
  }

  async markAllNotificationsRead() {
    return this.request('/api/subscription/notifications/read-all', {
      method: 'POST',
    });
  }

  // ============================================
  // Admin
  // ============================================

  async getAdminUsers(params?: {
    status?:
      | 'all'
      | 'active'
      | 'monthly'
      | 'yearly'
      | 'no_sub'
      | 'expired'
      | 'referrers'
      | 'new_payment'
      | 'pending';
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    users: any[];
    pagination: { total: number; page: number; limit: number; hasMore: boolean };
  }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString();
    return this.request(`/api/admin/users${suffix ? '?' + suffix : ''}`);
  }

  async getAdminUserCounts(): Promise<{
    counts: {
      all: number;
      active: number;
      monthly: number;
      yearly: number;
      no_sub: number;
      expired: number;
      referrers: number;
      new_payment: number;
      pending: number;
    };
  }> {
    // Global counts — no search param so the tab badges show overall totals
    return this.request('/api/admin/users/counts');
  }

  async signSlipUrls(keys: string[]): Promise<{ urls: Record<string, string | null> }> {
    return this.request('/api/admin/sign-slip-urls', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    });
  }

  async approveUser(userId: number) {
    return this.request(`/api/admin/users/${userId}/approve`, {
      method: 'PATCH',
    });
  }

  async extendUserSubscription(
    userId: number,
    days: number,
    planType?: 'monthly' | 'yearly',
    amount?: string,
    slipUrl?: string,
    planSlug?: string,
  ) {
    return this.request(`/api/admin/users/${userId}/extend`, {
      method: 'PATCH',
      body: JSON.stringify({
        days,
        // BE resolver priority: planSlug > planId > planType > derived-from-days.
        // Still send legacy planType for back-compat; if planSlug is set BE will
        // use it (supports admin-created custom plans like Premium).
        planType: planType || (days >= 365 ? 'yearly' : 'monthly'),
        ...(amount && { amount }),
        ...(slipUrl && { slipUrl }),
        ...(planSlug && { planSlug }),
      }),
    });
  }

  async adminUploadExtendSlip(
    userId: number,
    file: File,
    amount: string,
    days: number
  ): Promise<{ success: true; slipUrl: string; amount: string; transRef: string }> {
    const formData = new FormData();
    formData.append('slip', file);
    formData.append('amount', amount);
    formData.append('days', days.toString());
    formData.append('userId', userId.toString());

    const response = await fetch(`${this.apiUrl}/api/admin/upload-extend-slip`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      // Preserve Thunder/server error code so callers can show specific
      // localized messages (DUPLICATE_SLIP, INVALID_AMOUNT, EXPIRED_SLIP, ...)
      const err = new Error(error.error || 'Upload failed') as Error & { errorCode?: string };
      err.errorCode = error.errorCode;
      throw err;
    }

    return response.json();
  }

  async getExtensionHistory(userId: number) {
    return this.request(`/api/admin/users/${userId}/extension-history`);
  }

  async reduceUserSubscription(userId: number, days: number) {
    return this.request(`/api/admin/users/${userId}/reduce`, {
      method: 'PATCH',
      body: JSON.stringify({ days }),
    });
  }

  async deleteUser(userId: number) {
    return this.request(`/api/admin/users/${userId}`, {
      method: 'DELETE',
    });
  }

  async changeUserPlan(userId: number, plan: 'monthly' | 'yearly') {
    return this.request(`/api/admin/users/${userId}/change-plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan }),
    });
  }

  async getAdminRevenue(period: 'daily' | 'weekly' | 'monthly' = 'daily') {
    return this.request(`/api/admin/revenue?period=${period}`);
  }

  async getAdminRevenueReport(range: string = '7d') {
    return this.request(`/api/admin/revenue-report?range=${range}`);
  }

  // Admin Notifications
  async getAdminNotifications(): Promise<{ notifications: any[] }> {
    return this.request('/api/admin/notifications');
  }

  async createAdminNotification(data: {
    title: string;
    message: string;
    notificationType?: string;
    targetAudience?: string;
  }) {
    return this.request('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAdminNotification(id: number, data: {
    title?: string;
    message?: string;
    notificationType?: string;
    targetAudience?: string;
    isActive?: boolean;
  }) {
    return this.request(`/api/admin/notifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteAdminNotification(id: number) {
    return this.request(`/api/admin/notifications/${id}`, {
      method: 'DELETE',
    });
  }

  // User-facing admin notifications
  async getUserAdminNotifications(): Promise<{ notifications: any[] }> {
    return this.request('/api/subscription/admin-notifications');
  }

  async markAdminNotificationRead(id: number) {
    return this.request(`/api/subscription/admin-notifications/${id}/read`, {
      method: 'POST',
    });
  }

  // Admin Prompt Templates
  async getAdminPromptTemplates() {
    return this.request('/api/prompt-templates/admin/all');
  }

  async createAdminPromptTemplate(data: Record<string, any>) {
    return this.request('/api/prompt-templates/admin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAdminPromptTemplate(id: number, data: Record<string, any>) {
    return this.request(`/api/prompt-templates/admin/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAdminPromptTemplate(id: number) {
    return this.request(`/api/prompt-templates/admin/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Affiliate - User APIs
  // ============================================

  async getAffiliateAnnouncement() {
    return this.request('/api/affiliate/announcement');
  }

  async getAffiliateStats() {
    return this.request('/api/affiliate/my-stats');
  }

  async getAffiliateReferees() {
    return this.request('/api/affiliate/referees');
  }

  async getAffiliateTransfers() {
    return this.request('/api/affiliate/transfers');
  }

  // Wise Email
  async updateWiseEmail(email: string) {
    return this.request('/api/affiliate/wise-email', {
      method: 'PUT',
      body: JSON.stringify({ email }),
    });
  }

  // Thai Bank Account
  async saveThaiBankAccount(bankInfo: {
    bank_name: string;
    branch?: string;
    account_number: string;
    account_holder: string;
    phone?: string;
    tax_id?: string;
    tax_name?: string;
    tax_address?: string;
  }) {
    return this.request('/api/affiliate/bank-account', {
      method: 'PUT',
      body: JSON.stringify(bankInfo),
    });
  }

  /**
   * POST /api/affiliate/upload-id-card — upload สำเนาบัตรประชาชน (เซ็นรับรองสำเนา).
   * Optional. Same-key overwrite — call multiple times to replace.
   * @param file image (JPG/PNG/WebP) or PDF, ≤ 5MB
   */
  async uploadIdCard(file: File): Promise<{
    success: boolean;
    url: string;
    signed_url: string | null;
    uploaded_at: string;
  }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.request('/api/affiliate/upload-id-card', {
      method: 'POST',
      body: fd,
      // intentionally no Content-Type — let browser set multipart boundary
      headers: {},
    });
  }

  /**
   * Fetch an ID card from the BE proxy (auth-protected) as a Blob URL that
   * can be used as `<img src>` or `<iframe src>` in a preview dialog.
   *
   * Always fetches fresh from server (`cache: 'no-store'`) — file may have
   * been replaced via the fixed-key upload overwrite.
   *
   * Caller must `URL.revokeObjectURL(url)` when done to free memory.
   * Returns `null` if no ID card is uploaded for the user (404 → null).
   */
  async getIdCardPreviewBlobUrl(previewPath: string): Promise<string | null> {
    const r = await fetch(`${this.apiUrl}${previewPath}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: 'no-store',
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`ID card preview failed: ${r.status}`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  }

  // ─── Payment History + Tax Invoice ─────────────────────────────────

  /** User — list own paid extension history. Filtered server-side to
   *  approval_method ∈ {admin,autoapprove,stripe} AND amount > 0 (no
   *  coupon / promo rows). Distinct from `getExtensionHistory(userId)`
   *  above which is the admin-scoped one (takes a target userId). */
  async getMyExtensionHistory() {
    return this.request('/api/subscription/extension-history') as Promise<{
      history: import('@/types/payment').PaymentHistoryRow[];
    }>;
  }

  /** User — create a tax-invoice request for a paid extension. 409 if
   *  already requested (UNIQUE on extension_log_id). 400 if not eligible. */
  async requestTaxInvoice(logId: number) {
    return this.request(`/api/subscription/extension-history/${logId}/request-invoice`, {
      method: 'POST',
    });
  }

  /** User — fetch the issued invoice as a blob URL for inline preview
   *  (iframe). Caller must `URL.revokeObjectURL(url)` when done. Returns
   *  null on 404 (file not yet uploaded). */
  async getInvoicePreviewBlobUrl(requestId: number): Promise<string | null> {
    const r = await fetch(`${this.apiUrl}/api/subscription/tax-invoice/${requestId}/file`, {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: 'no-store',
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Invoice preview failed: ${r.status}`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  }

  /** User — trigger a download of the issued invoice. Uses the same proxy
   *  but with `?download=1` so BE sets Content-Disposition: attachment. */
  async downloadInvoice(requestId: number, filename = `invoice-${requestId}.pdf`) {
    const r = await fetch(`${this.apiUrl}/api/subscription/tax-invoice/${requestId}/file?download=1`, {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`Invoice download failed: ${r.status}`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Admin — paginated list of tax-invoice requests with user + extension
   *  + tax info joined. */
  async listTaxInvoiceRequests(opts: {
    status?: 'all' | 'pending' | 'issued' | 'rejected';
    q?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.q) params.set('q', opts.q);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request(`/api/admin/tax-invoices${qs ? `?${qs}` : ''}`) as Promise<
      import('@/types/payment').AdminTaxInvoiceListResponse
    >;
  }

  /** Admin — upload (or replace) the invoice file for a request.
   *  Same-key overwrite on the BE so re-uploading fixes a typo without
   *  creating a new request row. */
  async uploadTaxInvoice(requestId: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const r = await fetch(`${this.apiUrl}/api/admin/tax-invoices/${requestId}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'upload_failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return r.json() as Promise<{ success: true; invoice_url: string; status: 'issued' }>;
  }

  /** Admin — reject a pending request with a reason. 409 if already issued. */
  async rejectTaxInvoice(requestId: number, notes: string) {
    return this.request(`/api/admin/tax-invoices/${requestId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  }

  /** Admin — fetch the invoice file via admin proxy (no ownership check).
   *  Used for preview dialog on /admin → ใบกำกับภาษี. */
  async getAdminInvoicePreviewBlobUrl(requestId: number): Promise<string | null> {
    const r = await fetch(`${this.apiUrl}/api/admin/tax-invoices/${requestId}/file`, {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: 'no-store',
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Invoice preview failed: ${r.status}`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * PUT /api/affiliate/tax-info — partial update of WHT recipient info
   * (ภงด.3 / ภงด.53). Independent of bank-account endpoint so user can fill
   * tax info on /profile without touching their bank account.
   */
  async saveTaxInfo(input: {
    entity_type?: 'individual' | 'juristic';
    title_prefix?: string | null;
    tax_name?: string | null;
    tax_id?: string | null;
    address_line?: string | null;
    subdistrict?: string | null;
    district?: string | null;
    province?: string | null;
    postal_code?: string | null;
    tax_branch?: string | null;
  }) {
    return this.request('/api/affiliate/tax-info', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  // Payout Method
  async setPreferredPayoutMethod(method: 'wise' | 'thai_bank') {
    return this.request('/api/affiliate/payout-method', {
      method: 'PUT',
      body: JSON.stringify({ method }),
    });
  }

  // ============================================
  // Affiliate - Admin APIs
  // ============================================

  async updateAdminAffiliateAnnouncement(announcement: string) {
    return this.request('/api/affiliate/admin/announcement', {
      method: 'PUT',
      body: JSON.stringify({ announcement }),
    });
  }

  async getAdminDefaultCommission() {
    return this.request('/api/affiliate/admin/default-commission');
  }

  async updateAdminDefaultCommission(default_commission: number) {
    return this.request('/api/affiliate/admin/default-commission', {
      method: 'PUT',
      body: JSON.stringify({ default_commission }),
    });
  }

  async getAdminReferrers() {
    return this.request('/api/affiliate/admin/referrers');
  }

  async getAdminTransfers(status?: 'pending' | 'transferred') {
    const query = status ? `?status=${status}` : '';
    return this.request(`/api/affiliate/admin/transfers${query}`);
  }

  /** Grouped-by-referrer payouts. status='transferred' reuses the same
   *  shape as pending so the FE renders an identical card (different status). */
  async getAdminPendingPayouts(status?: 'pending' | 'transferred') {
    const query = status ? `?status=${status}` : '';
    return this.request(`/api/affiliate/admin/pending${query}`);
  }

  async adminMarkAsPaid(
    referrerId: number,
    payment_reference: string,
    notes?: string,
    proof_url?: string,
    wht_cert_url?: string,
  ) {
    return this.request(`/api/affiliate/admin/mark-paid/${referrerId}`, {
      method: 'POST',
      body: JSON.stringify({ payment_reference, notes, proof_url, wht_cert_url }),
    });
  }

  async uploadPaymentProof(file: File): Promise<{ url: string; signed_url: string | null; filename: string }> {
    const formData = new FormData();
    formData.append('proof', file);
    return this.request('/api/affiliate/admin/upload-proof', {
      method: 'POST',
      body: formData,
    });
  }

  async getAdminTiers(): Promise<{ tier1_percent: number; tier2_percent: number }> {
    return this.request('/api/affiliate/admin/tiers');
  }

  async updateTiers(tier1_percent: number, tier2_percent: number) {
    return this.request('/api/affiliate/admin/tiers', {
      method: 'PUT',
      body: JSON.stringify({ tier1_percent, tier2_percent }),
    });
  }

  /**
   * Assign a user to an affiliate tier. `tier_id` accepts any active tier in
   * affiliate_tiers (1, 2, 3, …). The legacy `tier` field (1|2 only) is still
   * accepted by the BE for backward compatibility.
   */
  async updateUserTier(userId: number, tierId: number) {
    return this.request(`/api/affiliate/admin/user-tier/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ tier_id: tierId, tier: tierId }), // send both shapes
    });
  }

  // Saved Late Profiles
  async getSavedLateProfiles() {
    return this.request('/api/scheduler/channels/late-profiles');
  }

  async createSavedLateProfile(data: { profile_id: string; display_name: string; avatar_url?: string }) {
    return this.request('/api/scheduler/channels/late-profiles', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteSavedLateProfile(id: number) {
    return this.request(`/api/scheduler/channels/late-profiles/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Viral Templates
  // ============================================

  async getViralTemplates(params?: { sort?: 'latest' | 'popular'; page?: number; limit?: number } | 'latest' | 'popular') {
    // Backward compat: caller may pass sort string directly
    const opts = typeof params === 'string' ? { sort: params } : (params || {});
    const sp = new URLSearchParams();
    if (opts.sort) sp.append('sort', opts.sort);
    if (opts.page !== undefined) sp.append('page', String(opts.page));
    if (opts.limit !== undefined) sp.append('limit', String(opts.limit));
    const qs = sp.toString();
    return this.request(`/api/viral-templates${qs ? '?' + qs : ''}`);
  }

  async getViralTemplate(slug: string) {
    return this.request(`/api/viral-templates/${slug}`);
  }

  async createViralJob(data: {
    template_slug: string;
    channel_id: number | null;
    language: string;
    scenes_per_video: number;
    tasks: Array<{ character_name: string; character_names?: string[] }>;
    custom_system_prompt?: string;
  }) {
    return this.request('/api/viral-templates/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Viral Custom Prompts
  async getAllViralPrompts() {
    return this.request('/api/viral-templates/all-prompts');
  }

  // (getAllIdolPrompts lives in the Idol Custom Prompts section below.)

  async getViralFavorites(): Promise<string[]> {
    return this.request('/api/viral-templates/favorites');
  }

  async toggleViralFavorite(slug: string) {
    return this.request(`/api/viral-templates/${slug}/favorite`, { method: 'POST' });
  }

  async getIdolFavorites(): Promise<string[]> {
    return this.request('/api/idol-templates/favorites');
  }

  async toggleIdolFavorite(slug: string) {
    return this.request(`/api/idol-templates/${slug}/favorite`, { method: 'POST' });
  }

  async getAllViralCustomPrompts() {
    return this.request('/api/viral-templates/custom-prompts-all');
  }

  async getViralCustomPrompts(templateSlug: string) {
    return this.request(`/api/viral-templates/custom-prompts/${templateSlug}`);
  }

  async createViralCustomPrompt(data: Record<string, any>) {
    return this.request('/api/viral-templates/custom-prompts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateViralCustomPrompt(id: number, data: Record<string, any>) {
    return this.request(`/api/viral-templates/custom-prompts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteViralCustomPrompt(id: number) {
    return this.request(`/api/viral-templates/custom-prompts/${id}`, {
      method: 'DELETE',
    });
  }

  async getViralJobs() {
    return this.request('/api/viral-templates/jobs');
  }

  async getViralJob(jobId: number) {
    return this.request(`/api/viral-templates/jobs/${jobId}`);
  }

  async generateViralTask(jobId: number, taskId: number, characterName?: string, characterNames?: string[], taskVariables?: Record<string, any>) {
    return this.request(`/api/viral-templates/jobs/${jobId}/tasks/${taskId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ character_name: characterName, character_names: characterNames, task_variables: taskVariables }),
    });
  }

  async generateAllViralTasks(jobId: number, tasks?: Array<{ id: number; character_name: string; character_names?: string[]; task_variables?: Record<string, any> }>) {
    return this.request(`/api/viral-templates/jobs/${jobId}/generate-all`, {
      method: 'POST',
      body: JSON.stringify({ tasks }),
    });
  }

  async deleteViralTask(jobId: number, taskId: number) {
    return this.request(`/api/viral-templates/jobs/${jobId}/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  async deleteViralJob(jobId: number) {
    return this.request(`/api/viral-templates/jobs/${jobId}`, {
      method: 'DELETE',
    });
  }

  async getViralJobStatus(jobId: number) {
    return this.request(`/api/viral-templates/jobs/${jobId}/status`);
  }

  async updateViralTask(jobId: number, taskId: number, data: { character_name?: string; character_names?: string[]; task_variables?: Record<string, any> }) {
    return this.request(`/api/viral-templates/jobs/${jobId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async retryViralTask(taskId: number | string) {
    return this.request(`/api/viral-templates/jobs/retry-task/${taskId}`, { method: 'POST' });
  }

  // ============================================
  // Viral Templates Admin CRUD
  // ============================================

  async getViralTemplatesAdmin() {
    return this.request('/api/viral-templates/admin');
  }

  async createViralTemplate(data: Record<string, any>) {
    return this.request('/api/viral-templates/admin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateViralTemplate(slug: string, data: Record<string, any>) {
    return this.request(`/api/viral-templates/admin/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteViralTemplate(slug: string) {
    return this.request(`/api/viral-templates/admin/${slug}`, {
      method: 'DELETE',
    });
  }

  // Upload one preset scene-ref image (admin only) — returns { url } from Dropbox
  async uploadViralTemplateSceneRef(file: File): Promise<{ key: string; url: string }> {
    const formData = new FormData();
    formData.append('image', file);
    return this.request('/api/viral-templates/admin/upload-scene-ref', {
      method: 'POST',
      body: formData,
    });
  }

  // ============================================
  // Idol Templates
  // ============================================

  async getIdolTemplates(params?: { sort?: 'latest' | 'popular'; page?: number; limit?: number } | 'latest' | 'popular') {
    const opts = typeof params === 'string' ? { sort: params } : (params || {});
    const sp = new URLSearchParams();
    if (opts.sort) sp.append('sort', opts.sort);
    if (opts.page !== undefined) sp.append('page', String(opts.page));
    if (opts.limit !== undefined) sp.append('limit', String(opts.limit));
    const qs = sp.toString();
    return this.request(`/api/idol-templates${qs ? '?' + qs : ''}`);
  }

  async getIdolTemplate(slug: string) {
    return this.request(`/api/idol-templates/${slug}`);
  }

  async createIdolJob(data: {
    template_slug: string;
    channel_id: number | null;
    language: string;
    scenes_per_video: number;
    duration?: number;
    tasks: Array<{ character_name: string; character_names?: string[] }>;
    custom_system_prompt?: string;
  }) {
    return this.request('/api/idol-templates/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Idol Custom Prompts
  async getAllIdolPrompts(sort?: 'latest' | 'popular') {
    const params = sort ? `?sort=${sort}` : '';
    return this.request(`/api/idol-templates/all-prompts${params}`);
  }

  async getAllIdolCustomPrompts() {
    return this.request('/api/idol-templates/custom-prompts-all');
  }

  async getIdolCustomPrompts(templateSlug: string) {
    return this.request(`/api/idol-templates/custom-prompts/${templateSlug}`);
  }

  async createIdolCustomPrompt(data: Record<string, any>) {
    return this.request('/api/idol-templates/custom-prompts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateIdolCustomPrompt(id: number, data: Record<string, any>) {
    return this.request(`/api/idol-templates/custom-prompts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteIdolCustomPrompt(id: number) {
    return this.request(`/api/idol-templates/custom-prompts/${id}`, {
      method: 'DELETE',
    });
  }

  async getIdolJobs() {
    return this.request('/api/idol-templates/jobs');
  }

  async getIdolJob(jobId: number) {
    return this.request(`/api/idol-templates/jobs/${jobId}`);
  }

  async generateIdolTask(jobId: number, taskId: number, characterName?: string, characterNames?: string[], taskVariables?: Record<string, any>) {
    return this.request(`/api/idol-templates/jobs/${jobId}/tasks/${taskId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ character_name: characterName, character_names: characterNames, task_variables: taskVariables }),
    });
  }

  async generateAllIdolTasks(jobId: number, tasks?: Array<{ id: number; character_name: string; character_names?: string[]; task_variables?: Record<string, any> }>) {
    return this.request(`/api/idol-templates/jobs/${jobId}/generate-all`, {
      method: 'POST',
      body: JSON.stringify({ tasks }),
    });
  }

  async deleteIdolTask(jobId: number, taskId: number) {
    return this.request(`/api/idol-templates/jobs/${jobId}/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  async deleteIdolJob(jobId: number) {
    return this.request(`/api/idol-templates/jobs/${jobId}`, {
      method: 'DELETE',
    });
  }

  async getIdolJobStatus(jobId: number) {
    return this.request(`/api/idol-templates/jobs/${jobId}/status`);
  }

  async updateIdolTask(jobId: number, taskId: number, data: { character_name?: string; character_names?: string[] }) {
    return this.request(`/api/idol-templates/jobs/${jobId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async retryIdolTask(taskId: number | string) {
    return this.request(`/api/idol-templates/jobs/retry-task/${taskId}`, { method: 'POST' });
  }

  // ============================================
  // Idol Image Upload
  async uploadIdolImage(file: File, category?: string): Promise<{ url: string; filename: string; id: number }> {
    const formData = new FormData();
    formData.append('image', file);
    if (category) formData.append('category', category);
    const response = await fetch(`${this.apiUrl}/api/idol-templates/upload-image`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return response.json();
  }

  async getIdolGallery(category?: string): Promise<Array<{ id: number; filename: string; shared_url: string; category: string; created_at: string }>> {
    const params = category ? `?category=${category}` : '';
    return this.request(`/api/idol-templates/gallery${params}`);
  }

  async deleteIdolGalleryImage(id: number) {
    return this.request(`/api/idol-templates/gallery/${id}`, { method: 'DELETE' });
  }

  // ============================================
  // Idol Templates Admin CRUD
  // ============================================

  async getIdolTemplatesAdmin() {
    return this.request('/api/idol-templates/admin');
  }

  async createIdolTemplate(data: Record<string, any>) {
    return this.request('/api/idol-templates/admin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateIdolTemplate(slug: string, data: Record<string, any>) {
    return this.request(`/api/idol-templates/admin/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteIdolTemplate(slug: string) {
    return this.request(`/api/idol-templates/admin/${slug}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Content History (consolidated)
  // ============================================

  async getContentHistory(params?: {
    type?: 'image' | 'video';
    /**
     * Content source. Includes both legacy values (viral_final_video, etc.) and
     * the standalone image sources (viral_image, idol_image) that the History
     * tab filters on. Kept as a wide union so the filter widget can pass any
     * of its options through without type-narrowing gymnastics.
     */
    source?:
      | 'viral_image'
      | 'viral_scene_video'
      | 'viral_final_video'
      | 'idol_image'
      | 'idol_scene_video'
      | 'idol_final_video'
      | 'gpt_image_2'
      | 'image_template'
      | 'kling_3_motion_control';
    channel_id?: number;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
    skip_count?: boolean;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.append('type', params.type);
    if (params?.source) searchParams.append('source', params.source);
    if (params?.channel_id) searchParams.append('channel_id', params.channel_id.toString());
    if (params?.date_from) searchParams.append('date_from', params.date_from);
    if (params?.date_to) searchParams.append('date_to', params.date_to);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.skip_count) searchParams.append('skip_count', '1');
    const qs = searchParams.toString();
    return this.request(`/api/content-history${qs ? `?${qs}` : ''}`);
  }

  async deleteContentHistory(ids: string[]): Promise<{ success: boolean; deleted: number }> {
    return this.request('/api/content-history/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  async moveContentHistory(ids: string[], targetChannelId: number): Promise<{ success: boolean; moved: number }> {
    return this.request('/api/content-history/move', {
      method: 'POST',
      body: JSON.stringify({ ids, target_channel_id: targetChannelId }),
    });
  }

  // ============ Admin: Update Banners ============
  async getAdminBanners() {
    return this.request('/api/admin/banners');
  }
  async getPublicBanners() {
    return this.request('/api/admin/banners/public');
  }
  async createBanner(data: any) {
    return this.request('/api/admin/banners', { method: 'POST', body: JSON.stringify(data) });
  }
  async updateBanner(id: number, data: any) {
    return this.request(`/api/admin/banners/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async deleteBanner(id: number) {
    return this.request(`/api/admin/banners/${id}`, { method: 'DELETE' });
  }
  async reorderBanners(ids: number[]) {
    return this.request('/api/admin/banners/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
  }
  async translateText(text: string, target: 'th' | 'en'): Promise<{ translation: string }> {
    return this.request('/api/admin/translate', { method: 'POST', body: JSON.stringify({ text, target }) });
  }

  async uploadBannerImage(file: File): Promise<{ key: string; url: string }> {
    const fd = new FormData();
    fd.append('image', file);
    const resp = await fetch(`${this.apiUrl}/api/admin/banners/upload-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: fd,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  // ============ Welcome Banner (popup modal) ============
  /**
   * User-facing: fetch the currently active welcome banner. Returns null if
   * none is active (popup will use a fallback image). WelcomePopup reads this
   * at mount to know which image to display and where clicking should navigate.
   */
  async getActiveWelcomeBanner(): Promise<{ id: number; image_url: string; link_url: string | null } | null> {
    const r: any = await this.request('/api/subscription/welcome-banner/active');
    return r?.banner ?? null;
  }

  /** Admin: list all welcome banners (active + inactive). `link_url` is
   *  nullable — null means the popup is display-only (no click destination). */
  async listWelcomeBanners(): Promise<{
    banners: Array<{
      id: number;
      image_url: string;
      link_url: string | null;
      label: string | null;
      is_active: boolean;
      display_order: number;
      created_at: string;
      updated_at: string;
    }>;
  }> {
    return this.request('/api/admin/welcome-banners') as Promise<any>;
  }

  /** Admin: create a new (inactive) welcome banner. Empty / null `link_url`
   *  publishes a display-only popup (click only dismisses). */
  async createWelcomeBanner(input: { image_url: string; link_url?: string | null; label?: string; display_order?: number }) {
    return this.request('/api/admin/welcome-banners', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Admin: partial update — image_url / link_url / label / display_order.
   *  Pass `link_url: null` or `''` to clear the destination.
   *  Toggling is_active goes through /activate so the one-active invariant
   *  stays atomic. */
  async updateWelcomeBanner(id: number, patch: {
    image_url?: string;
    link_url?: string | null;
    label?: string | null;
    display_order?: number;
  }) {
    return this.request(`/api/admin/welcome-banners/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  /** Admin: atomic swap — deactivate the current active banner and set
   *  this id active. */
  async activateWelcomeBanner(id: number) {
    return this.request(`/api/admin/welcome-banners/${id}/activate`, {
      method: 'POST',
    });
  }

  /** Admin: delete a banner. Refuses with 409 if the row is currently
   *  active — activate another one first. */
  async deleteWelcomeBanner(id: number) {
    return this.request(`/api/admin/welcome-banners/${id}`, {
      method: 'DELETE',
    });
  }

  // ============ GPT Image 2 ============
  async gptImage2Generate(params: {
    prompt: string;
    mode: 'text-to-image' | 'image-to-image';
    aspect_ratio?: string;
    resolution?: string;
    files?: File[];
    channel_id?: number | string;
    template_slug?: string;
    template_thumbnail_url?: string;
  }): Promise<{ success: boolean; task: any }> {
    const formData = new FormData();
    formData.append('prompt', params.prompt);
    formData.append('mode', params.mode);
    if (params.aspect_ratio) formData.append('aspect_ratio', params.aspect_ratio);
    if (params.resolution) formData.append('resolution', params.resolution);
    if (params.channel_id) formData.append('channel_id', String(params.channel_id));
    if (params.template_slug) formData.append('template_slug', params.template_slug);
    if (params.template_thumbnail_url) formData.append('template_thumbnail_url', params.template_thumbnail_url);
    if (params.files) {
      for (const f of params.files) formData.append('files', f);
    }
    const response = await fetch(`${this.apiUrl}/api/gpt-image-2/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async gptImage2Status(taskId: string): Promise<{ task: any }> {
    return this.request(`/api/gpt-image-2/status/${encodeURIComponent(taskId)}`);
  }

  async gptImage2History(params?: { limit?: number; offset?: number; template_slug?: string }): Promise<{ items: any[]; total: number }> {
    const sp = new URLSearchParams();
    if (params?.limit) sp.append('limit', String(params.limit));
    if (params?.offset) sp.append('offset', String(params.offset));
    if (params?.template_slug !== undefined) sp.append('template_slug', params.template_slug);
    const qs = sp.toString();
    return this.request(`/api/gpt-image-2/history${qs ? `?${qs}` : ''}`);
  }

  async gptImage2Delete(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/gpt-image-2/${id}`, { method: 'DELETE' });
  }

  // ============ Grok Imagine ============
  async grokImagineGenerate(params: {
    prompt: string;
    mode: 'text-to-image' | 'image-to-image';
    aspect_ratio?: string;
    enable_pro?: boolean;
    files?: File[];
    channel_id?: number | string;
    template_slug?: string;
  }): Promise<{ success: boolean; task: any }> {
    const formData = new FormData();
    formData.append('prompt', params.prompt);
    formData.append('mode', params.mode);
    if (params.aspect_ratio) formData.append('aspect_ratio', params.aspect_ratio);
    if (params.enable_pro) formData.append('enable_pro', 'true');
    if (params.channel_id) formData.append('channel_id', String(params.channel_id));
    if (params.template_slug) formData.append('template_slug', params.template_slug);
    if (params.files) {
      for (const f of params.files) formData.append('files', f);
    }
    const response = await fetch(`${this.apiUrl}/api/grok-imagine/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async grokImagineStatus(taskId: string): Promise<{ task: any }> {
    return this.request(`/api/grok-imagine/status/${encodeURIComponent(taskId)}`);
  }

  async grokImagineHistory(params?: { limit?: number; offset?: number; template_slug?: string }): Promise<{ items: any[]; total: number }> {
    const sp = new URLSearchParams();
    if (params?.limit) sp.append('limit', String(params.limit));
    if (params?.offset) sp.append('offset', String(params.offset));
    if (params?.template_slug !== undefined) sp.append('template_slug', params.template_slug);
    const qs = sp.toString();
    return this.request(`/api/grok-imagine/history${qs ? `?${qs}` : ''}`);
  }

  async grokImagineDelete(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/grok-imagine/${id}`, { method: 'DELETE' });
  }

  // ============ Nano Banana 2 ============
  async nanoBanana2Generate(params: {
    prompt: string;
    mode: 'text-to-image' | 'image-to-image';
    aspect_ratio?: string;
    resolution?: string;
    output_format?: 'png' | 'jpg';
    files?: File[];
    channel_id?: number | string;
    template_slug?: string;
    template_thumbnail_url?: string;
  }): Promise<{ success: boolean; task: any }> {
    const formData = new FormData();
    formData.append('prompt', params.prompt);
    formData.append('mode', params.mode);
    if (params.aspect_ratio) formData.append('aspect_ratio', params.aspect_ratio);
    if (params.resolution) formData.append('resolution', params.resolution);
    if (params.output_format) formData.append('output_format', params.output_format);
    if (params.channel_id) formData.append('channel_id', String(params.channel_id));
    if (params.template_slug) formData.append('template_slug', params.template_slug);
    if (params.template_thumbnail_url) formData.append('template_thumbnail_url', params.template_thumbnail_url);
    if (params.files) {
      for (const f of params.files) formData.append('files', f);
    }
    const response = await fetch(`${this.apiUrl}/api/nano-banana-2/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async nanoBanana2Status(taskId: string): Promise<{ task: any }> {
    return this.request(`/api/nano-banana-2/status/${encodeURIComponent(taskId)}`);
  }

  async nanoBanana2History(params?: { limit?: number; offset?: number; template_slug?: string }): Promise<{ items: any[]; total: number }> {
    const sp = new URLSearchParams();
    if (params?.limit) sp.append('limit', String(params.limit));
    if (params?.offset) sp.append('offset', String(params.offset));
    if (params?.template_slug !== undefined) sp.append('template_slug', params.template_slug);
    const qs = sp.toString();
    return this.request(`/api/nano-banana-2/history${qs ? `?${qs}` : ''}`);
  }

  async nanoBanana2Delete(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/nano-banana-2/${id}`, { method: 'DELETE' });
  }

  // ============ Nano Banana Pro ============
  async nanoBananaProGenerate(params: {
    prompt: string;
    mode: 'text-to-image' | 'image-to-image';
    aspect_ratio?: string;
    resolution?: string;
    output_format?: 'png' | 'jpg';
    files?: File[];
    channel_id?: number | string;
    template_slug?: string;
  }): Promise<{ success: boolean; task: any }> {
    const formData = new FormData();
    formData.append('prompt', params.prompt);
    formData.append('mode', params.mode);
    if (params.aspect_ratio) formData.append('aspect_ratio', params.aspect_ratio);
    if (params.resolution) formData.append('resolution', params.resolution);
    if (params.output_format) formData.append('output_format', params.output_format);
    if (params.channel_id) formData.append('channel_id', String(params.channel_id));
    if (params.template_slug) formData.append('template_slug', params.template_slug);
    if (params.files) {
      for (const f of params.files) formData.append('files', f);
    }
    const response = await fetch(`${this.apiUrl}/api/nano-banana-pro/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async nanoBananaProStatus(taskId: string): Promise<{ task: any }> {
    return this.request(`/api/nano-banana-pro/status/${encodeURIComponent(taskId)}`);
  }

  async nanoBananaProHistory(params?: { limit?: number; offset?: number; template_slug?: string }): Promise<{ items: any[]; total: number }> {
    const sp = new URLSearchParams();
    if (params?.limit) sp.append('limit', String(params.limit));
    if (params?.offset) sp.append('offset', String(params.offset));
    if (params?.template_slug !== undefined) sp.append('template_slug', params.template_slug);
    const qs = sp.toString();
    return this.request(`/api/nano-banana-pro/history${qs ? `?${qs}` : ''}`);
  }

  async nanoBananaProDelete(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/nano-banana-pro/${id}`, { method: 'DELETE' });
  }

  // ============ Story Template Gallery ============
  async storyGalleryUpload(file: File, category: string): Promise<{ success: boolean; item: any }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    const response = await fetch(`${this.apiUrl}/api/story-template-gallery/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async storyGalleryList(category?: string): Promise<{ items: any[] }> {
    const sp = new URLSearchParams();
    if (category) sp.append('category', category);
    const qs = sp.toString();
    return this.request(`/api/story-template-gallery/list${qs ? `?${qs}` : ''}`);
  }

  async storyGalleryDelete(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/story-template-gallery/${id}`, { method: 'DELETE' });
  }

  // ============ Story Template ============
  async storyTemplateGenerate(params: {
    template_slug?: string;
    model: string;
    prompt_template: string;
    variables?: Record<string, string>;
    image_inputs?: { mainImage?: string; outfitImage?: string; backgroundImage?: string; objectImage?: string };
    text_values?: { outfitText?: string; backgroundText?: string };
    aspect_ratio?: string;
    resolution?: string;
    channel_id?: number | string;
    group_id?: string;
    scene_number?: number;
    scene_count?: number;
    duration?: number;
    video_resolution?: string;
    topic?: string;
    existing_task_id?: number;
  }): Promise<{ success: boolean; task: any }> {
    return this.request('/api/story-template/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async storyTemplateStatus(taskId: string): Promise<{ task: any }> {
    return this.request(`/api/story-template/status/${encodeURIComponent(taskId)}`);
  }

  // Smart retry — backend decides between concat-only / video-only / full re-gen
  async storyTemplateRetry(taskDbId: number): Promise<{ success: boolean; mode: 'concat-only' | 'video-only' | 'full' }> {
    return this.request(`/api/story-template/tasks/${taskDbId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate composite image at group level (1 image used by all scene videos)
  async storyTemplateCompositeGenerate(groupId: string, force = false): Promise<{ success: boolean; composite_image_url: string; reused: boolean }> {
    return this.request(`/api/story-template/groups/${encodeURIComponent(groupId)}/composite-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
  }

  async storyTemplateGroupStatus(groupId: string): Promise<{ group: any; tasks: any[] }> {
    return this.request(`/api/story-template/groups/${encodeURIComponent(groupId)}`);
  }

  // Viral-style draft persistence
  async storyTemplateCreateGroup(params: {
    template_slug: string;
    channel_id?: number | string | null;
    scene_count: number;
    video_resolution?: string;
    duration?: number;
    model?: string;
    topic?: string;
    group_id?: string;
  }): Promise<{ group: any; tasks: any[] }> {
    return this.request('/api/story-template/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async storyTemplatePatchGroup(groupId: string, patch: Partial<{
    topic: string;
    channel_id: number | string | null;
    video_resolution: string;
    selected_option_id: number | null;
    composite_image_prompt: string;
  }>): Promise<{ success: boolean; group: any }> {
    return this.request(`/api/story-template/groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async storyTemplatePatchTask(groupId: string, taskId: number, patch: Partial<{
    image_inputs: any;
    text_values: any;
    prompt: string;
    aspect_ratio: string;
    resolution: string;
    variables: any;
    model: string;
  }>): Promise<{ success: boolean; task: any }> {
    return this.request(`/api/story-template/groups/${encodeURIComponent(groupId)}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async storyTemplateDeleteGroup(groupId: string): Promise<{ success: boolean }> {
    return this.request(`/api/story-template/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
  }

  async storyTemplateListGroups(template_slug: string): Promise<{ groups: any[]; tasks: any[] }> {
    const sp = new URLSearchParams({ template_slug });
    return this.request(`/api/story-template/groups?${sp.toString()}`);
  }

  async storyTemplateGenerateOptions(params: {
    group_id: string;
    topic: string;
    template_slug?: string;
    scene_count?: number;
    channel_id?: number | string;
    image_references?: string[];
    scene_references?: { scene: number; main?: string; outfit?: string; background?: string; object?: string }[];
  }): Promise<{ success: boolean; options: any[] }> {
    return this.request('/api/story-template/generate-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async storyTemplateHistory(params?: { limit?: number; offset?: number; template_slug?: string }): Promise<{ items: any[]; total: number }> {
    const sp = new URLSearchParams();
    if (params?.limit) sp.append('limit', String(params.limit));
    if (params?.offset) sp.append('offset', String(params.offset));
    if (params?.template_slug !== undefined) sp.append('template_slug', params.template_slug);
    const qs = sp.toString();
    return this.request(`/api/story-template/history${qs ? `?${qs}` : ''}`);
  }

  async storyTemplateDelete(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/story-template/${id}`, { method: 'DELETE' });
  }

  // Public: list / single (for user-facing Story Template tab + detail)
  async getStoryTemplatesPublic() {
    return this.request('/api/story-template/list');
  }

  // Cross-device draft state (per templateSlug, per user)
  async saveStoryTemplateDraftState(template_slug: string, state: any): Promise<{ success: boolean }> {
    return this.request('/api/story-template/draft-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_slug, state }),
    });
  }

  async getStoryTemplateDraftState(template_slug: string): Promise<{ state: any; updated_at?: string }> {
    return this.request(`/api/story-template/draft-state/${encodeURIComponent(template_slug)}`);
  }

  async getStoryTemplateBySlug(slug: string) {
    return this.request(`/api/story-template/by-slug/${encodeURIComponent(slug)}`);
  }

  // Admin CRUD for story templates
  async getStoryTemplatesAdmin() {
    return this.request('/api/story-template/admin');
  }

  async createStoryTemplate(data: Record<string, any>) {
    return this.request('/api/story-template/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async updateStoryTemplate(slug: string, data: Record<string, any>) {
    return this.request(`/api/story-template/admin/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async deleteStoryTemplate(slug: string) {
    return this.request(`/api/story-template/admin/${slug}`, {
      method: 'DELETE',
    });
  }

  // ============ Image Template (admin-managed) ============
  async getImageTemplatesPublic(): Promise<{ items: any[] }> {
    return this.request('/api/image-template/list');
  }

  async getImageTemplateBySlug(slug: string): Promise<any> {
    return this.request(`/api/image-template/by-slug/${encodeURIComponent(slug)}`);
  }

  async getImageTemplatesAdmin(): Promise<any[]> {
    return this.request('/api/image-template/admin');
  }

  async createImageTemplate(data: Record<string, any>): Promise<any> {
    return this.request('/api/image-template/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async updateImageTemplate(slug: string, data: Record<string, any>): Promise<any> {
    return this.request(`/api/image-template/admin/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async deleteImageTemplate(slug: string): Promise<{ success: boolean }> {
    return this.request(`/api/image-template/admin/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    });
  }

  // Per-user, per-template draft state (cross-device persistence of tasks + shared options).
  async getImageTemplateDraftState(slug: string): Promise<{ state: any; updated_at?: string }> {
    return this.request(`/api/image-template/draft-state/${encodeURIComponent(slug)}`);
  }

  async saveImageTemplateDraftState(template_slug: string, state: any): Promise<{ success: boolean }> {
    return this.request(`/api/image-template/draft-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_slug, state }),
    });
  }

  async clearImageTemplateDraftState(slug: string): Promise<{ success: boolean }> {
    return this.request(`/api/image-template/draft-state/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  }

  async uploadImageTemplateThumbnail(file: File): Promise<{ url: string; key: string }> {
    const fd = new FormData();
    fd.append('image', file);
    const resp = await fetch(`${this.apiUrl}/api/admin/image-templates/upload-thumbnail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: fd,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed (HTTP ${resp.status})`);
    }
    return resp.json();
  }

  async analyzeImageTemplateThumbnail(imageUrl: string, promptTemplate: string): Promise<{ prompt_template: string; schema?: any }> {
    // 2-pass AI vision (~30-60s) — bump timeout to 180s, no auto-retry (don't repeat the long call on transient failures).
    return this.request('/api/admin/image-templates/analyze-thumbnail', {
      method: 'POST',
      body: JSON.stringify({ image_url: imageUrl, prompt_template: promptTemplate }),
    }, 0, 180000);
  }

  async extractImageTemplateName(imageUrl: string): Promise<{ name_en: string; name_th: string; description_en: string; description_th: string }> {
    // Vision call (~10-20s) — bump timeout to 90s, no retry.
    return this.request('/api/admin/image-templates/extract-name', {
      method: 'POST',
      body: JSON.stringify({ image_url: imageUrl }),
    }, 0, 90000);
  }

  // ============ Image Template — User Gallery (per-user, S3-backed) ============

  async uploadImageTemplateGalleryImage(file: File): Promise<{ id: number; filename: string; shared_url: string; category: string; created_at: string }> {
    const fd = new FormData();
    fd.append('image', file);
    const resp = await fetch(`${this.apiUrl}/api/image-template/gallery/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: fd,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed (HTTP ${resp.status})`);
    }
    return resp.json();
  }

  async getImageTemplateGallery(): Promise<Array<{ id: number; filename: string; shared_url: string; category: string; created_at: string }>> {
    return this.request('/api/image-template/gallery');
  }

  async deleteImageTemplateGalleryImage(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/image-template/gallery/${id}`, { method: 'DELETE' });
  }

  // ============ Kling 3.0 Motion Control ============
  async kling3MotionControlGenerate(params: {
    prompt?: string;
    image: File;
    video: File;
    mode?: string;
    character_orientation?: string;
    background_source?: string;
    channel_id?: string;
  }): Promise<{ success: boolean; task: any }> {
    const formData = new FormData();
    formData.append('image', params.image);
    formData.append('video', params.video);
    if (params.prompt) formData.append('prompt', params.prompt);
    if (params.mode) formData.append('mode', params.mode);
    if (params.character_orientation) formData.append('character_orientation', params.character_orientation);
    if (params.background_source) formData.append('background_source', params.background_source);
    if (params.channel_id) formData.append('channel_id', params.channel_id);
    const response = await fetch(`${this.apiUrl}/api/kling-3-motion-control/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[kling3MotionControlGenerate] Backend error response:', err);
      if (err.curlCommand) {
        console.error('[kling3MotionControlGenerate] curl command (copy this for KIE support):\n' + err.curlCommand);
      }
      if (err.requestBody) {
        console.error('[kling3MotionControlGenerate] Request body sent to KIE:', err.requestBody);
      }
      const errMsg = err.error || `HTTP ${response.status}`;
      const errDetails = err.details ? ` (KIE details: ${JSON.stringify(err.details)})` : '';
      throw new Error(`${errMsg}${errDetails}`);
    }
    return response.json();
  }

  async kling3MotionControlStatus(taskId: string): Promise<{ task: any }> {
    return this.request(`/api/kling-3-motion-control/status/${encodeURIComponent(taskId)}`);
  }

  async kling3MotionControlHistory(params?: { limit?: number; offset?: number }): Promise<{ items: any[]; total: number }> {
    const sp = new URLSearchParams();
    if (params?.limit) sp.append('limit', String(params.limit));
    if (params?.offset) sp.append('offset', String(params.offset));
    const qs = sp.toString();
    return this.request(`/api/kling-3-motion-control/history${qs ? `?${qs}` : ''}`);
  }

  async kling3MotionControlDelete(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/kling-3-motion-control/${id}`, { method: 'DELETE' });
  }

  // ---------- AI Agent (8-stage Reels pipeline) ----------

  async storyAgentCreate(params: {
    topic: string;
    duration_sec: number;
    tone?: string;
    language?: 'th' | 'en';
    channel_id?: number;
  }): Promise<{ success: boolean; job: any }> {
    return this.request('/api/story-agent/create', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async storyAgentStatus(id: number): Promise<{ job: any; scenes: any[] }> {
    return this.request(`/api/story-agent/status/${id}`);
  }

  async storyAgentHistory(params?: { limit?: number; offset?: number }): Promise<{ items: any[]; total: number }> {
    const sp = new URLSearchParams();
    if (params?.limit) sp.append('limit', String(params.limit));
    if (params?.offset) sp.append('offset', String(params.offset));
    const qs = sp.toString();
    return this.request(`/api/story-agent/history${qs ? `?${qs}` : ''}`);
  }

  async storyAgentDelete(id: number): Promise<{ success: boolean }> {
    return this.request(`/api/story-agent/${id}`, { method: 'DELETE' });
  }

  // ---------- User Skills (chat AI Agent) ----------

  async skillsList(): Promise<{ items: UserSkillDto[] }> {
    return this.request(`/api/skills`);
  }

  async skillsGet(id: number): Promise<{ skill: UserSkillDto }> {
    return this.request(`/api/skills/${id}`);
  }

  async skillsCreate(input: {
    name: string;
    description?: string | null;
    content_md: string;
    is_default?: boolean;
  }): Promise<{ skill: UserSkillDto }> {
    return this.request(`/api/skills`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async skillsUpdate(
    id: number,
    patch: {
      name?: string;
      description?: string | null;
      content_md?: string;
      is_default?: boolean;
    },
  ): Promise<{ skill: UserSkillDto }> {
    return this.request(`/api/skills/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async skillsDelete(id: number): Promise<{ ok: boolean }> {
    return this.request(`/api/skills/${id}`, { method: 'DELETE' });
  }

  async skillsListTemplates(): Promise<{ items: SkillTemplateDto[] }> {
    return this.request(`/api/skills/templates`);
  }

  async skillsForkTemplate(
    templateId: number,
    overrideName?: string,
  ): Promise<{ skill: UserSkillDto }> {
    return this.request(`/api/skills/templates/${templateId}/fork`, {
      method: 'POST',
      body: JSON.stringify(overrideName ? { name: overrideName } : {}),
    });
  }

  // ---------- Chat threads (AI Agent) ----------

  async chatThreadsList(): Promise<{ items: ChatThreadSummaryDto[] }> {
    return this.request(`/api/story-agent/chat/threads`);
  }

  async chatThreadCreate(input?: {
    title?: string;
    active_skill_ids?: number[];
  }): Promise<{ thread: ChatThreadDto }> {
    return this.request(`/api/story-agent/chat/threads`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
  }

  async chatThreadGet(id: number): Promise<{ thread: ChatThreadDto }> {
    return this.request(`/api/story-agent/chat/threads/${id}`);
  }

  async chatThreadPatch(
    id: number,
    patch: { title?: string; active_skill_ids?: number[] },
  ): Promise<{ thread: ChatThreadDto }> {
    return this.request(`/api/story-agent/chat/threads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async chatThreadDelete(id: number): Promise<{ ok: boolean }> {
    return this.request(`/api/story-agent/chat/threads/${id}`, { method: 'DELETE' });
  }

  /**
   * Send a user message and stream the agent's response via SSE.
   * Returns an async generator that yields each parsed event.
   */
  async *chatThreadSend(
    threadId: number,
    text: string,
  ): AsyncGenerator<ChatStreamEventDto, void, unknown> {
    const url = `${this.apiUrl}/api/story-agent/chat/threads/${threadId}/send`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok || !resp.body) {
      const errBody = await resp.json().catch(() => ({ error: 'Stream failed' }));
      throw new Error(errBody.error || `HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by \n\n. Each event begins with "data: ".
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const evRaw of events) {
        const line = evRaw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload) as ChatStreamEventDto;
          yield parsed;
          if (parsed.type === 'done') return;
        } catch {
          // ignore malformed payloads
        }
      }
    }
  }

  // ============================================
  // Courses (Course Learning System)
  // ============================================

  async getCourses(params?: { featured?: boolean; difficulty?: string; search?: string; sort?: string; type?: 'course' | 'tip' }) {
    const qs = new URLSearchParams();
    if (params?.featured) qs.set('featured', 'true');
    if (params?.difficulty) qs.set('difficulty', params.difficulty);
    if (params?.search) qs.set('search', params.search);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.type) qs.set('type', params.type);
    const q = qs.toString();
    return this.request(`/api/courses${q ? `?${q}` : ''}`);
  }
  // ============================================
  // Articles (บทความ — เมนู Content)
  // ============================================
  /** Public catalog — metadata only, active articles. */
  async getArticles(): Promise<ArticleDto[]> {
    return this.request('/api/articles');
  }
  /** One article with its body (content_html or content_url). */
  async getArticle(slug: string): Promise<ArticleDto> {
    return this.request(`/api/articles/${encodeURIComponent(slug)}`);
  }
  async getAdminArticles(): Promise<ArticleDto[]> {
    return this.request('/api/articles/admin/all');
  }
  async createArticle(data: Partial<ArticleDto>): Promise<ArticleDto> {
    return this.request('/api/articles', { method: 'POST', body: JSON.stringify(data) });
  }
  async updateArticle(id: number, data: Partial<ArticleDto>): Promise<ArticleDto> {
    return this.request(`/api/articles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async deleteArticle(id: number): Promise<{ ok: boolean }> {
    return this.request(`/api/articles/${id}`, { method: 'DELETE' });
  }

  // ============================================
  // Guide clips (คลิปคู่มือหน้า /guide)
  // ============================================
  /** Public — groups shown on /guide, newest arrangement first. */
  async getGuideGroups(): Promise<GuideGroupDto[]> {
    return this.request('/api/guide/groups');
  }
  /** Public — one group plus its clips (the /guide/:slug page). */
  async getGuideGroup(slug: string): Promise<GuideGroupDto> {
    return this.request(`/api/guide/groups/${encodeURIComponent(slug)}`);
  }
  /** อัปโหลดภาพปกของคู่มือ (ผู้ดูแลคู่มือใช้ได้ ไม่ต้องเป็นแอดมินเต็ม) */
  async uploadGuideImage(file: File): Promise<{ url: string }> {
    const formData = new FormData();
    formData.append('image', file);
    return this.request('/api/guide/upload-image', { method: 'POST', body: formData });
  }
  async getAdminGuideGroups(): Promise<GuideGroupDto[]> {
    return this.request('/api/guide/groups/admin/all');
  }
  async createGuideGroup(data: Partial<GuideGroupDto>): Promise<GuideGroupDto> {
    return this.request('/api/guide/groups', { method: 'POST', body: JSON.stringify(data) });
  }
  async updateGuideGroup(id: number, data: Partial<GuideGroupDto>): Promise<GuideGroupDto> {
    return this.request(`/api/guide/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  /** ลบกลุ่ม = คลิปในกลุ่มหายไปด้วย (FK cascade) */
  async deleteGuideGroup(id: number): Promise<{ ok: boolean }> {
    return this.request(`/api/guide/groups/${id}`, { method: 'DELETE' });
  }
  async reorderGuideGroups(ids: number[]): Promise<{ ok: boolean }> {
    return this.request('/api/guide/groups/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
  }

  /** Public — active clips in display order. No auth: /guide is open to everyone. */
  async getGuideClips(): Promise<GuideClipDto[]> {
    return this.request('/api/guide/clips');
  }
  async getAdminGuideClips(groupId?: number): Promise<GuideClipDto[]> {
    const qs = groupId ? `?group_id=${groupId}` : '';
    return this.request(`/api/guide/clips/admin/all${qs}`);
  }
  async createGuideClip(data: Partial<GuideClipDto>): Promise<GuideClipDto> {
    return this.request('/api/guide/clips', { method: 'POST', body: JSON.stringify(data) });
  }
  async updateGuideClip(id: number, data: Partial<GuideClipDto>): Promise<GuideClipDto> {
    return this.request(`/api/guide/clips/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async deleteGuideClip(id: number): Promise<{ ok: boolean }> {
    return this.request(`/api/guide/clips/${id}`, { method: 'DELETE' });
  }
  /** Persist the whole card order — ids in the order they should appear. */
  async reorderGuideClips(ids: number[]): Promise<{ ok: boolean }> {
    return this.request('/api/guide/clips/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
  }

  /** Guide admins — full admins only; a guide admin cannot appoint anyone. */
  async getGuideAdmins(): Promise<GuideAdminDto[]> {
    return this.request('/api/guide/admins');
  }
  /** Existing email → flag it. Unknown email → create the account (password required). */
  async grantGuideAdmin(email: string, password?: string): Promise<GuideAdminDto & { created: boolean }> {
    return this.request('/api/guide/admins', { method: 'POST', body: JSON.stringify({ email, password }) });
  }
  async revokeGuideAdmin(id: number): Promise<{ ok: boolean }> {
    return this.request(`/api/guide/admins/${id}`, { method: 'DELETE' });
  }
  async resetGuideAdminPassword(id: number, password: string): Promise<{ ok: boolean }> {
    return this.request(`/api/guide/admins/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
  }

  // ============================================
  // Tags (ชื่อย่อขึ้นเมนู header — คลังกลาง Course/Tip)
  // ============================================
  async getTags(): Promise<TagDto[]> {
    return this.request('/api/courses/tags');
  }
  async createTag(name: string): Promise<TagDto> {
    return this.request('/api/courses/tags', { method: 'POST', body: JSON.stringify({ name }) });
  }
  async deleteTag(id: number): Promise<{ ok: boolean }> {
    return this.request(`/api/courses/tags/${id}`, { method: 'DELETE' });
  }

  /** Pin (or unpin) the course shown on the home-page billboard. Unpinned = automatic (newest course). */
  async setCourseBillboard(courseId: number, pinned: boolean) {
    return this.request(`/api/courses/${courseId}/billboard`, {
      method: 'PUT',
      body: JSON.stringify({ pinned }),
    });
  }
  async getCourse(slug: string) {
    return this.request(`/api/courses/${encodeURIComponent(slug)}`);
  }
  async getCourseFull(slug: string) {
    return this.request(`/api/courses/${encodeURIComponent(slug)}/full`);
  }
  // Subscription-gated per-lesson video. Paid lesson youtube ids are only ever
  // returned through this endpoint (never in list/detail payloads).
  async getLessonVideo(slug: string, lessonId: number) {
    return this.request(`/api/courses/${encodeURIComponent(slug)}/lessons/${lessonId}/video`);
  }
  /** Full materials (incl. inline html content) for one lesson — list payloads carry metadata only. */
  async getLessonMaterials(lessonId: number): Promise<{ lesson_id: number; materials: any[] }> {
    return this.request(`/api/courses/lessons/${lessonId}/materials`);
  }
  /** Custom episode cover (admin). Delete reverts to the auto YouTube thumbnail. */
  async uploadLessonCover(lessonId: number, file: File): Promise<{ ok: boolean; cover_url: string }> {
    const form = new FormData();
    form.append('cover', file);
    return this.request(`/api/courses/lessons/${lessonId}/cover`, { method: 'POST', body: form });
  }
  async deleteLessonCover(lessonId: number): Promise<{ ok: boolean }> {
    return this.request(`/api/courses/lessons/${lessonId}/cover`, { method: 'DELETE' });
  }
  async getAdminCourses() {
    return this.request('/api/courses/admin/all');
  }
  async createCourse(data: Record<string, unknown>) {
    return this.request('/api/courses', { method: 'POST', body: JSON.stringify(data) });
  }
  async updateCourse(id: number, data: Record<string, unknown>) {
    return this.request(`/api/courses/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async deleteCourse(id: number) {
    return this.request(`/api/courses/${id}`, { method: 'DELETE' });
  }
  async uploadCourseThumbnail(file: File): Promise<{ url: string }> {
    const formData = new FormData();
    formData.append('thumbnail', file);
    return this.request('/api/courses/upload-thumbnail', { method: 'POST', body: formData });
  }
  async uploadCourseMaterial(file: File): Promise<{ url: string; name: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request('/api/courses/upload-material', { method: 'POST', body: formData });
  }
  async uploadCourseHtml(file: File): Promise<{ url: string; name: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request('/api/courses/upload-html', { method: 'POST', body: formData });
  }
  // Sections
  async getCourseSections(courseId: number) {
    return this.request(`/api/courses/${courseId}/sections`);
  }
  async createSection(courseId: number, data: { title: string; description?: string; section_order?: number; mode?: 'basic' | 'update' }) {
    return this.request(`/api/courses/${courseId}/sections`, { method: 'POST', body: JSON.stringify(data) });
  }
  async updateSection(sectionId: number, data: Record<string, unknown>) {
    return this.request(`/api/courses/sections/${sectionId}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async deleteSection(sectionId: number) {
    return this.request(`/api/courses/sections/${sectionId}`, { method: 'DELETE' });
  }
  async reorderSections(courseId: number, sectionIds: number[]) {
    return this.request(`/api/courses/${courseId}/sections/reorder`, { method: 'PUT', body: JSON.stringify({ sectionIds }) });
  }
  async assignLessonsToSection(sectionId: number, lessonIds: number[]) {
    return this.request(`/api/courses/sections/${sectionId}/lessons/assign`, { method: 'PUT', body: JSON.stringify({ lessonIds }) });
  }
  async unassignLesson(lessonId: number) {
    return this.request(`/api/courses/lessons/${lessonId}/unassign`, { method: 'PUT' });
  }
  // Lessons
  async getCourseLessons(courseId: number) {
    return this.request(`/api/courses/${courseId}/lessons`);
  }
  async createLesson(courseId: number, data: Record<string, unknown>) {
    return this.request(`/api/courses/${courseId}/lessons`, { method: 'POST', body: JSON.stringify(data) });
  }
  async updateLesson(lessonId: number, data: Record<string, unknown>) {
    return this.request(`/api/courses/lessons/${lessonId}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async deleteLesson(lessonId: number) {
    return this.request(`/api/courses/lessons/${lessonId}`, { method: 'DELETE' });
  }
  async reorderLessons(courseId: number, lessonIds: number[]) {
    return this.request(`/api/courses/${courseId}/lessons/reorder`, { method: 'PUT', body: JSON.stringify({ lessonIds }) });
  }
  // Reviews — public read, auth+approved-enrollment to write, admin to delete.
  async getCourseReviews(slug: string): Promise<{
    reviews: Array<{ id: number; rating: number; comment: string | null; created_at: string; reviewer: string }>;
    avg: number;
    count: number;
  }> {
    return this.request(`/api/courses/${encodeURIComponent(slug)}/reviews`);
  }
  async submitReview(courseId: number | string, body: { rating: number; comment?: string }) {
    return this.request(`/api/courses/${courseId}/reviews`, { method: 'POST', body: JSON.stringify(body) });
  }
  async deleteReview(id: number) {
    return this.request(`/api/courses/reviews/${id}`, { method: 'DELETE' });
  }
  // Enrollments — per-course purchase (slip → admin approval) + progress records.
  // Subscribers also get an auto 'approved' enrollment (source='subscription') for progress.
  // POST a buy request for a course. Optional payment slip (image, ≤10MB).
  async enrollCourse(courseId: number, slip?: File) {
    const formData = new FormData();
    if (slip) formData.append('slip', slip);
    return this.request(`/api/enrollments/${courseId}/enroll`, {
      method: 'POST',
      body: formData,
    });
  }
  async getMyEnrollments(status?: string) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/api/enrollments/mine${qs}`);
  }
  async getEnrollmentStatus(courseId: number) {
    return this.request(`/api/enrollments/status/${courseId}`);
  }
  async updateEnrollmentProgress(enrollmentId: number, data: { completed_lesson_id?: number; last_lesson_id?: number }) {
    return this.request(`/api/enrollments/${enrollmentId}/progress`, { method: 'PUT', body: JSON.stringify(data) });
  }

  // Enrollments (admin) — review + approve/reject/revoke buy requests.
  async getAdminEnrollments(params?: { status?: string; course_id?: number; search?: string; limit?: number; offset?: number }): Promise<{ enrollments: any[]; total: number }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.course_id != null) qs.set('course_id', String(params.course_id));
    if (params?.search) qs.set('search', params.search);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const suffix = qs.toString();
    return this.request(`/api/enrollments/admin/all${suffix ? `?${suffix}` : ''}`);
  }
  async getEnrollmentStats(): Promise<{ pending_count: number; approved_count: number; rejected_count: number; total_count: number }> {
    return this.request('/api/enrollments/admin/stats');
  }
  async approveEnrollment(id: number) {
    return this.request(`/api/enrollments/admin/${id}/approve`, { method: 'PUT' });
  }
  async rejectEnrollment(id: number, reason?: string) {
    return this.request(`/api/enrollments/admin/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason }) });
  }
  async revokeEnrollment(id: number, reason?: string) {
    return this.request(`/api/enrollments/admin/${id}/revoke`, { method: 'PUT', body: JSON.stringify({ reason }) });
  }
  async bulkApproveEnrollments(enrollment_ids: number[]) {
    return this.request('/api/enrollments/admin/bulk-approve', { method: 'POST', body: JSON.stringify({ enrollment_ids }) });
  }

  // ---------- Agent Chat (FAB widget) ----------
  // Sends carry retries=0 + a long timeout: a timed-out LLM call must NOT be
  // silently re-posted (would duplicate the user message + double-bill the AI).
  async agentChatSend(data: {
    conversation_id?: number;
    guest_id?: string;
    course_id: number;
    text: string;
    image?: File;
  }): Promise<AgentChatThreadDto> {
    // With an image → multipart; text-only → JSON. Same endpoint either way.
    if (data.image) {
      const form = new FormData();
      if (data.conversation_id) form.append('conversation_id', String(data.conversation_id));
      if (data.guest_id) form.append('guest_id', data.guest_id);
      form.append('course_id', String(data.course_id));
      form.append('text', data.text);
      form.append('image', data.image);
      return this.request('/api/agent-chat/message', { method: 'POST', body: form }, 0, 120000);
    }
    const { image: _img, ...json } = data;
    return this.request('/api/agent-chat/message', { method: 'POST', body: JSON.stringify(json) }, 0, 90000);
  }
  /**
   * Streamed send (SSE): onDelta fires per text chunk while the bot writes;
   * resolves with the final thread. Throws on transport failure — caller
   * should fall back to agentChatSend().
   */
  async agentChatSendStream(
    data: { conversation_id?: number; guest_id?: string; course_id: number; text: string; image?: File },
    onDelta: (text: string) => void
  ): Promise<AgentChatThreadDto> {
    let body: BodyInit;
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (data.image) {
      const form = new FormData();
      if (data.conversation_id) form.append('conversation_id', String(data.conversation_id));
      if (data.guest_id) form.append('guest_id', data.guest_id);
      form.append('course_id', String(data.course_id));
      form.append('text', data.text);
      form.append('image', data.image);
      body = form;
    } else {
      headers['Content-Type'] = 'application/json';
      const { image: _i, ...json } = data;
      body = JSON.stringify(json);
    }
    const resp = await fetch(`${this.apiUrl}/api/agent-chat/message/stream`, { method: 'POST', headers, body });
    if (!resp.ok || !resp.body) {
      const err = await resp.json().catch(() => ({ error: 'stream failed' }));
      throw new Error((err as any).error || 'stream failed');
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done: AgentChatThreadDto | null = null;
    let streamError: string | null = null;
    for (;;) {
      const { value, done: eof } = await reader.read();
      if (eof) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const eventMatch = frame.match(/^event: (.+)$/m);
        const dataMatch = frame.match(/^data: (.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        try {
          const payload = JSON.parse(dataMatch[1]);
          if (eventMatch[1] === 'delta' && payload.text) onDelta(payload.text);
          else if (eventMatch[1] === 'done') done = payload;
          else if (eventMatch[1] === 'error') streamError = payload.error || 'stream error';
        } catch {
          /* ignore malformed frame */
        }
      }
    }
    if (streamError) throw new Error(streamError);
    if (!done) throw new Error('stream ended without done event');
    return done;
  }
  async agentChatGetConversation(courseId: number, guestId?: string): Promise<AgentChatThreadDto> {
    const qs = new URLSearchParams({ course_id: String(courseId) });
    if (guestId) qs.set('guest_id', guestId);
    return this.request(`/api/agent-chat/conversation?${qs}`);
  }
  async agentChatEscalate(data: { conversation_id: number; guest_id?: string; contact_info?: string }): Promise<AgentChatThreadDto> {
    return this.request('/api/agent-chat/escalate', { method: 'POST', body: JSON.stringify(data) });
  }
  async agentChatBackToAi(data: { conversation_id: number; guest_id?: string }): Promise<AgentChatThreadDto> {
    return this.request('/api/agent-chat/back-to-ai', { method: 'POST', body: JSON.stringify(data) });
  }
  // Admin
  async agentChatAdminCounts(): Promise<{ escalated: number; answered: number }> {
    return this.request('/api/agent-chat/admin/counts');
  }
  async agentChatAdminList(params?: { status?: string; search?: string }): Promise<{ conversations: any[]; counts: any }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString();
    return this.request(`/api/agent-chat/admin/list${suffix ? `?${suffix}` : ''}`);
  }
  async agentChatAdminGet(id: number): Promise<AgentChatThreadDto & { user_email: string | null }> {
    return this.request(`/api/agent-chat/admin/${id}`);
  }
  async agentChatAdminReply(id: number, text: string): Promise<AgentChatThreadDto> {
    return this.request(`/api/agent-chat/admin/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
  }
  async agentChatAdminSetStatus(id: number, status: string) {
    return this.request(`/api/agent-chat/admin/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }
  async agentChatCourseSubtitles(courseId: number): Promise<{
    lessons: Array<{
      lesson_id: number;
      title: string;
      lesson_order: number;
      has_youtube: boolean;
      has_sub: boolean;
      chars: number;
      /** stored but too short to be useful knowledge (speechless clip) */
      too_short: boolean;
      language: string | null;
      fetched_at: string | null;
      /** last fetch attempt, recorded even when it stored nothing */
      last_status: 'ok' | 'no_captions' | 'too_short' | 'failed' | null;
      last_reason: string | null;
      last_detail: string | null;
      last_attempt_at: string | null;
    }>;
  }> {
    return this.request(`/api/agent-chat/admin/course/${courseId}/subtitles`);
  }
  /** Can the server reach YouTube captions right now? Separates "server refused" from "clip has none". */
  async agentChatYoutubeHealth(): Promise<{
    ok: boolean;
    ms?: number;
    chars?: number;
    language?: string;
    reason?: string;
    detail?: string;
    probe_lesson?: string;
    message: string;
  }> {
    return this.request('/api/agent-chat/admin/youtube-health', {}, 0, 60000);
  }
  async agentChatUploadSubtitle(
    lessonId: number,
    file: File,
    language?: string
  ): Promise<{ ok: boolean; lesson_id: number; format: string; chars: number }> {
    const form = new FormData();
    form.append('file', file);
    if (language) form.append('language', language);
    return this.request(`/api/agent-chat/admin/lessons/${lessonId}/subtitle`, { method: 'POST', body: form });
  }
  async agentChatSyncLessonSubtitle(
    lessonId: number
  ): Promise<{ ok: boolean; lesson_id: number; language: string; chars: number }> {
    return this.request(`/api/agent-chat/admin/lessons/${lessonId}/sync-subtitle`, { method: 'POST' }, 0, 60000);
  }
  async agentChatDeleteSubtitle(lessonId: number): Promise<{ ok: boolean }> {
    return this.request(`/api/agent-chat/admin/lessons/${lessonId}/subtitle`, { method: 'DELETE' });
  }
  async agentChatSyncSubtitles(courseId: number): Promise<SubtitleSyncSummary> {
    // Fetching captions for a whole course can take a while — long timeout, no retry.
    return this.request(`/api/agent-chat/admin/course/${courseId}/sync-subtitles`, { method: 'POST' }, 0, 300000);
  }
  /** Every active course, lessons that still have no subtitle. Long job — 10 min timeout. */
  async agentChatSyncMissingSubtitles(): Promise<
    SubtitleSyncSummary & {
      courses: Array<{ course_id: number; course_name: string; ok: number; no_captions: number; too_short: number; failed: number }>;
    }
  > {
    return this.request('/api/agent-chat/admin/sync-subtitles-missing', { method: 'POST' }, 0, 600000);
  }
  // Knowledge base (คลังความรู้บอท)
  async agentChatKnowledgeList(): Promise<{ knowledge: AgentKnowledgeDto[] }> {
    return this.request('/api/agent-chat/admin/knowledge');
  }
  async agentChatKnowledgeCreate(data: { title: string; content: string }): Promise<{ knowledge: AgentKnowledgeDto }> {
    return this.request('/api/agent-chat/admin/knowledge', { method: 'POST', body: JSON.stringify(data) });
  }
  async agentChatKnowledgeUpdate(id: number, data: Partial<Pick<AgentKnowledgeDto, 'title' | 'content' | 'is_active' | 'display_order'>>): Promise<{ knowledge: AgentKnowledgeDto }> {
    return this.request(`/api/agent-chat/admin/knowledge/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  async agentChatKnowledgeDelete(id: number) {
    return this.request(`/api/agent-chat/admin/knowledge/${id}`, { method: 'DELETE' });
  }
}

/**
 * Result of a subtitle sync. The buckets matter: `no_captions` means YouTube has
 * nothing for that video (yet), `too_short` means it returned captions we refuse
 * to store (speechless clip), `failed` means the fetch itself broke — the UI must
 * not report all three as "ไม่พบซับ".
 */
export interface SubtitleSyncSummary {
  total: number;
  ok: number;
  no_captions: number;
  too_short: number;
  failed: number;
  results: Array<{
    lesson_id: number;
    title: string;
    status: 'ok' | 'no_captions' | 'too_short' | 'failed';
    chars?: number;
    language?: string;
    reason?: string;
    message?: string;
  }>;
}

/** Tag = ชื่อย่อขึ้นเมนู header; Tip ที่ใช้ tag เดียวกับคอร์ส = เกาะกับคอร์สนั้น */
export interface TagDto {
  id: number;
  name: string;
  display_order: number;
  created_at: string;
  /** จำนวนคอร์ส+ทิปที่ใช้ tag นี้ (จาก GET /tags) */
  course_count?: number;
}

/** บทความ (เมนู Content) — เนื้อหาอยู่ใน content_html (วางตรง) หรือ content_url (ไฟล์ HTML บน S3) */
export interface GuideGroupDto {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
  is_active: boolean;
  display_order: number;
  /** จำนวนคลิปในกลุ่ม (ฝั่ง public นับเฉพาะคลิปที่เปิดอยู่) */
  clip_count?: number | string;
  /** มากับ getGuideGroup(slug) เท่านั้น */
  clips?: GuideClipDto[];
}

export interface GuideAdminDto {
  id: number;
  email: string;
  join_date?: string;
  /** true = แอดมินเต็มระบบอยู่แล้ว (ไม่ได้ถูกจำกัดแค่คู่มือ) */
  is_admin: boolean;
}

export interface GuideClipDto {
  id: number;
  /** กลุ่มที่คลิปนี้อยู่ */
  group_id?: number | null;
  title: string;
  subtitle: string | null;
  /** ลิงก์ YouTube ของคลิป */
  url: string;
  /** ภาพปกที่ใส่ทับเอง — null = ดึงจาก YouTube ตาม url */
  thumbnail: string | null;
  /** ปุ่มลิงก์ใต้การ์ด */
  links: { label: string; url: string }[];
  is_active: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface ArticleDto {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_url: string | null;
  content_html?: string | null;
  content_url?: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  /** admin list only */
  content_chars?: number;
  has_content_file?: boolean;
}

export interface AgentKnowledgeDto {
  id: number;
  title: string;
  content: string;
  is_active: boolean;
  display_order: number;
  updated_at: string;
}

export interface AgentChatMessageDto {
  id: number;
  sender_type: 'user' | 'ai' | 'admin';
  body: string;
  image_url?: string | null;
  created_at: string;
}

export interface AgentChatConversationDto {
  id: number;
  user_id: number | null;
  guest_id: string | null;
  course_id: number | null;
  course_name?: string | null;
  status: 'ai' | 'escalated' | 'answered' | 'closed';
  escalate_reason: string | null;
  contact_info: string | null;
  last_message_at: string;
  created_at: string;
}

export interface AgentChatThreadDto {
  conversation: AgentChatConversationDto | null;
  messages: AgentChatMessageDto[];
}

// ---------- DTOs (re-exported for components) ----------

export interface UserSkillDto {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  content_md: string;
  frontmatter: Record<string, unknown> | null;
  trigger_keywords: string[] | null;
  source_template_id: number | null;
  is_default: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface SkillTemplateDto {
  id: number;
  name: string;
  category: string;
  description: string;
  content_md: string;
  preview_image_url: string | null;
  is_featured: boolean;
}

export interface ChatMessageContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface CreditTransactionDto {
  id: number;
  userId: number;
  type: 'deduct' | 'refund' | 'purchase' | 'admin_add' | 'admin_deduct' | 'bonus' | 'registration';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  createdByAdminId?: number | null;
  createdAt: string;
}

export interface ChatMessageDto {
  role: 'user' | 'assistant';
  content: string | ChatMessageContentBlock[];
}

export interface ChatThreadSummaryDto {
  id: number;
  title: string | null;
  active_skill_ids: number[];
  linked_job_id: number | null;
  msg_count: number;
  updated_at: string;
}

export interface ChatThreadDto {
  id: number;
  user_id: number;
  title: string | null;
  active_skill_ids: number[];
  messages: ChatMessageDto[];
  linked_job_id: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface ChatStreamEventDto {
  type:
    | 'text_delta'
    | 'tool_use_start'
    | 'tool_use_result'
    | 'turn_end'
    | 'error'
    | 'done';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
  raw_result?: unknown;
  message?: string;
}

export const api = new ApiClient();

// Helper to get API base URL for constructing full URLs to API-served files
export const getApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL as string;
  }
  return '';
};
