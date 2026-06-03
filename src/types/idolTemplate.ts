export interface TemplateVariable {
  key: string;
  label: string;
  placeholder: string;
  description: string;
  enabled: boolean;
  per_scene: boolean;
}

export interface FieldConfig {
  show_channel: boolean;
  show_language: boolean;
  show_scenes: boolean;
  show_videos: boolean;
  default_scenes?: number;
  per_scene_vars?: boolean;
}

export interface IdolTemplate {
  slug: string;
  name: string;
  description: string;
  thumbnail_url: string;
  preview_video_url?: string;
  input_mode?: 'single' | 'multi';
  input_label?: string;
  input_placeholder?: string;
  template_variables?: TemplateVariable[];
  fixed_scenes?: number | null;
  scene_descriptions?: string[];
  field_config?: FieldConfig;
  yearly_only?: boolean;
  gender?: 'male' | 'female' | null;
  times_used?: number;
}

export interface IdolTemplateAdmin extends IdolTemplate {
  id: number;
  system_prompt: string;
  image_prompt_template?: string;
  video_prompt_template?: string;
  display_order: number;
  is_active: boolean;
  yearly_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface IdolTemplateJob {
  id: number;
  user_id: number;
  template_slug: string;
  channel_id: number | null;
  language: string;
  scenes_per_video: number;
  custom_system_prompt?: string | null;
  custom_prompt_id?: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  tasks: IdolTemplateTask[];
}

export interface IdolCustomPrompt {
  id: number;
  user_id: number;
  template_slug: string;
  name: string;
  prompt_text: string;
  description?: string;
  youtube_url?: string;
  thumbnail_url?: string;
  template_variables?: TemplateVariable[];
  field_config?: FieldConfig;
  fixed_scenes?: number | null;
  scene_descriptions?: string[];
  created_at: string;
  updated_at: string;
}

export type TaskStepStatus = 'pending' | 'generating' | 'done' | 'failed';

export interface SceneProgress {
  scene: number;
  kie_task_id?: string;
  status: TaskStepStatus;
  image_url?: string;
  video_url?: string;
}

export interface ScenePrompt {
  scene: number;
  scene_name: string;
  image_prompt: string;
  video_prompt: string;
}

export interface IdolTemplateTask {
  id: number;
  job_id: number;
  task_index: number;
  character_name: string;
  character_names?: string[] | null;
  task_variables?: Record<string, string | string[]>;
  status: string; // pending | prompt_generating | image_generating | video_generating | concatenating | done | failed
  current_step: string | null; // ai_prompt | image_gen | video_gen | concat
  ai_prompts: ScenePrompt[] | null;
  image_tasks: SceneProgress[];
  video_tasks: SceneProgress[];
  final_video_url: string | null;
  error: string | null;
  logs: { time: string; emoji: string; text: string }[];
  created_at: string;
  updated_at: string;
}
