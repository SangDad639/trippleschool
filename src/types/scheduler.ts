// Scheduler Types for Content Scheduler feature

export interface VariableValue {
  id: string;
  value: string;
  status: 'new' | 'used';
}

export interface Variable {
  name: string;
  values: VariableValue[];
  system_prompt?: string;
  loop?: boolean;
}

export interface PromptTemplate {
  id: string;
  label: string;
  prompt_template: string;
  variables: Variable[];
  extend_prompt_template?: string;
  extend_variables?: Variable[];
}

export type PostingService = 'blotato' | 'late' | 'postforme' | 'none';

export type AiModel =
  | 'sora2_15s'
  | 'veo3_1'
  | 'grok_imagine'
  | 'kie_sora2'
  | 'kie_grok_imagine'
  | 'kie_grok_extend'
  | 'kie_viral_template'
  | 'kie_idol_template';

export interface PageIds {
  facebook: string;
  instagram: string;
  tiktok: string;
  twitter: string;
  youtube: string;
}

export interface LateAccountMapping {
  platform: string;
  accountId: string;
}

export interface LatePostResult {
  platform: string;
  postId?: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface SavedLateProfile {
  id: number;
  user_id: number;
  profile_id: string;
  display_name: string;
  avatar_url?: string;
  created_at: string;
}

export interface PostForMePostResult {
  platform: string;
  postId?: string;
  status: 'success' | 'failed';
  error?: string;
}

/**
 * Per-provider result from Postforme's GET /v1/social-posts/{id}.
 * Populated by the backend status-polling job after the post_at time.
 */
export interface PostForMeProviderResult {
  spr_id: string;
  platform: string;
  account_id?: string;
  status: 'success' | 'failed' | 'pending';
  error?: string | null;
  platform_url?: string | null;
  checked_at: string;
}

export interface ChannelExamplePrompt {
  id: number;
  channel_id: number;
  prompt_text: string;
  display_order: number;
  times_used: number;
  created_at: string;
}

export interface SchedulerChannel {
  id: number;
  user_id: number;
  name: string;
  platform: 'sora2-kie' | 'sora2-grsai' | 'sora2-vidgo';
  duration: '6' | '8' | '10' | '15' | '20' | '30';
  ai_model?: AiModel;
  aspect_ratio: 'portrait' | 'landscape';
  prompt_mode: 'ai' | 'variable';
  prompt_template: string;
  variables: Variable[];
  prompt_templates?: PromptTemplate[];
  ai_prompt_templates?: PromptTemplate[];
  selected_viral_prompts?: any[];
  template_selection_mode?: 'round-robin' | 'random';
  caption_language: 'en' | 'th';
  custom_hashtags: string;
  timezone: string;
  posts_per_day: number;
  time_slots?: string[];
  posting_service?: PostingService;
  blotato_account_id?: string;
  blotato_api_key?: string;
  page_ids?: PageIds;
  late_api_key?: string;
  late_profile_id?: string;
  late_accounts?: LateAccountMapping[];
  postforme_api_key?: string;
  postforme_accounts?: string[];
  fb_admin_profile_id?: string;
  channel_highlight?: string;
  channel_concept?: string;
  system_prompt?: string;
  system_prompt_generated_at?: string;
  example_prompts?: ChannelExamplePrompt[];
  auto_retry_hours?: number | null;
  prompt_temperature?: number;
  // Watermark settings (applied to final video before Dropbox upload)
  watermark_enabled?: boolean;
  watermark_type?: 'text' | 'image' | 'both';
  watermark_text?: string;
  watermark_image_url?: string | null;
  watermark_image_path?: string | null;
  watermark_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  watermark_opacity?: number;
  watermark_image_size?: 'small' | 'medium' | 'large';
  watermark_circular?: boolean;
  // Extend-mode prompt (used by kie_grok_extend and similar models) — separate
  // template + variable list from the main prompt so each can be edited
  // independently.
  extend_prompt?: string;
  extend_variables?: Variable[];
  created_at: string;
  updated_at: string;
}

export interface BlotatoPostResult {
  platform: string;
  postId?: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface ScheduleQueueItem {
  id: number;
  user_id: number;
  channel_id: number;
  channel_name?: string;
  scheduled_time: string;
  prompt: string;
  variable_values: Record<string, string>;
  platform: 'sora2-kie' | 'sora2-grsai' | 'sora2-vidgo';
  duration: '6' | '8' | '10' | '15' | '20' | '30';
  aspect_ratio: 'portrait' | 'landscape';
  status:
    | 'pending'
    | 'queued'
    | 'generating'
    | 'captioning'
    | 'scheduling'
    | 'posting_retry'
    | 'done'
    | 'failed'
    // Viral / Idol / image-template specific pipeline states (introduced by
    // those feature paths). All map to the same lifecycle (in-progress) for
    // legacy code that only checks generic statuses.
    | 'viral_pending'
    | 'viral_running'
    | 'idol_pending'
    | 'idol_running'
    | 'image_generating';
  posting_attempts?: number;
  retry_after_at?: string;
  video_url?: string;
  thumbnail_url?: string;
  caption?: string;
  blotato_post_ids?: BlotatoPostResult[];
  late_post_ids?: LatePostResult[];
  postforme_post_ids?: PostForMePostResult[];
  postforme_post_results?: PostForMeProviderResult[];
  posting_service?: PostingService;
  error?: string;
  retry_count?: number;
  retry_mode?: 'limited' | 'unlimited';
  extend_prompt?: string;
  created_at: string;
  updated_at: string;
}

export interface TimePreset {
  id: number;
  user_id: number;
  name: string;
  times: string[];
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  summary: {
    total: number;
    pending: number;
    inProgress: number;
    done: number;
    failed: number;
    successRate: number;
    doneToday: number;
    avgProcessingSeconds: number;
  };
  dailyTrend: Array<{
    date: string;
    total: number;
    done: number;
    failed: number;
    pending: number;
  }>;
  channelPerformance: Array<{
    channelId: number;
    channelName: string;
    total: number;
    done: number;
    failed: number;
    successRate: number;
    postingService: string;
    lastActivity: string;
  }>;
  platformReliability: Array<{
    platform: string;
    success: number;
    failed: number;
    total: number;
  }>;
  postingHeatmap: Array<{
    dayOfWeek: number;
    hour: number;
    count: number;
    done: number;
  }>;
  topErrors: Array<{
    error: string;
    count: number;
    lastOccurrence: string;
  }>;
  pipelineTiming: {
    avgGenerationSeconds: number;
    avgCaptioningSeconds: number;
    avgPostingSeconds: number;
  };
}

export interface ScheduleSlot {
  id: string;
  date: string;
  dayName: string;
  time: string;
  scheduledTime: string;
  variableValues: Record<string, string>;
  status: 'empty' | 'new' | 'exists';
  existingItem?: ScheduleQueueItem;
}

export interface ChannelStockInfo {
  channelId: number;
  pendingInQueue: number;
  unusedVariables: number;
  postsPerDay: number;
  daysOfContent: number;
}

export interface QueueStats {
  total: number;
  pending: number;
  queued: number;
  generating: number;
  captioning: number;
  scheduling: number;
  done: number;
  failed: number;
}

export interface QueueResponse {
  items: ScheduleQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export type QueueItem = ScheduleQueueItem;

export interface ChannelFormData {
  name: string;
  platform: 'sora2-kie' | 'sora2-grsai' | 'sora2-vidgo';
  duration: '6' | '8' | '10' | '15' | '20' | '30';
  ai_model?: AiModel;
  aspect_ratio: 'portrait' | 'landscape';
  prompt_mode: 'ai' | 'variable';
  prompt_template: string;
  variables: Variable[];
  prompt_templates?: PromptTemplate[];
  ai_prompt_templates?: PromptTemplate[];
  template_selection_mode?: 'round-robin' | 'random';
  caption_language: 'en' | 'th';
  custom_hashtags: string;
  timezone: string;
  posts_per_day: number;
  time_slots?: string[];
  posting_service?: PostingService;
  blotato_account_id?: string;
  blotato_api_key?: string;
  page_ids?: PageIds;
  late_api_key?: string;
  late_profile_id?: string;
  late_accounts?: LateAccountMapping[];
  postforme_api_key?: string;
  postforme_accounts?: string[];
  fb_admin_profile_id?: string;
  channel_highlight?: string;
  channel_concept?: string;
  example_prompts?: string[];
  auto_retry_hours?: number | null;
  prompt_temperature?: number;
  // Watermark settings
  watermark_enabled?: boolean;
  watermark_type?: 'text' | 'image' | 'both';
  watermark_text?: string;
  watermark_image_url?: string | null;
  watermark_image_path?: string | null;
  watermark_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  watermark_opacity?: number;
  watermark_image_size?: 'small' | 'medium' | 'large';
  watermark_circular?: boolean;
  /** Extend-mode prompt + variables (see SchedulerChannel.extend_prompt). */
  extend_prompt?: string;
  extend_variables?: Variable[];
}

export interface CreateQueueItemData {
  channel_id: number;
  scheduled_time: string;
  prompt: string;
  variable_values: Record<string, string>;
  platform?: string;
  duration?: string;
  aspect_ratio?: string;
}

export interface CalendarDayData {
  date: string;
  dayNum: number;
  outsideMonth: boolean;
  isPast: boolean;
  isToday: boolean;
  isSelected: boolean;
  slots: ScheduleSlot[];
}

export interface CalendarState {
  currentMonth: Date;
  selectedDates: Set<string>;
  slotsByDate: Record<string, ScheduleSlot[]>;
}

// Content History (consolidated history tab)
export interface ContentHistoryItem {
  id: string;
  type: 'image' | 'video';
  source:
    | 'viral_image'
    | 'viral_scene_video'
    | 'viral_final_video'
    | 'idol_image'
    | 'idol_scene_video'
    | 'idol_final_video'
    | 'gpt_image_2'
    | 'image_template'
    | 'kling_3_motion_control'
    | 'schedule_queue';
  url: string;
  thumbnail_url?: string | null;
  channel_id: number | null;
  channel_name: string | null;
  created_at: string;
  character_name?: string;
  scene_number?: number;
  task_id?: number;
  job_id?: number;
  queue_item_id?: number;
  aspect_ratio?: string;
  prompt?: string;
}

export interface ContentHistoryResponse {
  items: ContentHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}
