export interface StoryTemplateVariable {
  key: string;
  label: string;
  placeholder: string;
  description: string;
  enabled: boolean;
  per_scene: boolean;
}

export interface StoryFieldConfig {
  show_channel?: boolean;
  show_scenes?: boolean;
  show_videos?: boolean;
  default_scenes?: number;
  per_scene_vars?: boolean;
}

export interface StoryTemplateAdmin {
  id: number;
  slug: string;
  name: string;
  description: string;
  thumbnail_url: string;
  preview_video_url?: string;
  image_prompt_template?: string;
  video_prompt_template?: string;
  system_prompt?: string;
  template_variables?: StoryTemplateVariable[];
  fixed_scenes?: number | null;
  scene_descriptions?: string[];
  field_config?: StoryFieldConfig;
  display_order: number;
  is_active: boolean;
  yearly_only: boolean;
  gender?: 'male' | 'female' | null;
  created_at: string;
  updated_at: string;
}
