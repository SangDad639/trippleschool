export interface TemplateVariable {
  key: string;
  label: string;
  placeholder: string;
  description: string;
  enabled: boolean;
  per_scene: boolean;
  max_length?: number; // optional character limit per input (used by templates like "ลิง")
  // Optional default value used to pre-fill the field when the task is first opened.
  // - For per_scene=true: provide a string[] (one entry per scene)
  // - For per_scene=false: provide a single string
  default_value?: string | string[];
}

export interface FieldConfig {
  show_channel: boolean;
  show_language: boolean;
  show_scenes: boolean;
  show_videos: boolean;
  default_scenes?: number;
  per_scene_vars?: boolean;
  // When true: pipeline uses uploaded per-scene reference images directly as Grok image-to-video input,
  // skipping the AI image generation step entirely. Only used by templates that opt in (e.g. "ลิง").
  direct_video_from_ref?: boolean;
  // Optional preset reference images shipped with the template. Frontend pre-fills the matching
  // reference-image slot for each scene so the user only has to provide the variable parts (e.g. character).
  // Each array must have one URL per scene (length matches fixed_scenes).
  preset_scene_refs?: {
    character?: string[];
    outfit?: string[];
    background?: string[];
  };
  // When true: picking a character image applies it to ALL scenes of the current task automatically,
  // skipping the scope dialog. Used by templates where the same character is meant to appear in every scene
  // (e.g. "ลิง"). Other templates default to false (the user gets the per-scene scope picker as before).
  auto_apply_character?: boolean;
}

export interface ViralTemplate {
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
  times_used?: number;
  reference_image_config?: ReferenceImageConfig | null;
}

export interface ReferenceImageConfig {
  character?: boolean;
  outfit?: boolean;
  background?: boolean;
  movie_scene?: boolean;
  labels?: { character?: string; outfit?: string; background?: string; movie_scene?: string };
}

export interface ViralTemplateAdmin extends ViralTemplate {
  id: number;
  system_prompt: string;
  display_order: number;
  is_active: boolean;
  yearly_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface ViralTemplateJob {
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
  tasks: ViralTemplateTask[];
}

export interface ViralCustomPrompt {
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

export interface ViralTemplateTask {
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
