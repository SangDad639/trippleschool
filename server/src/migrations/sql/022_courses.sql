-- 022_courses.sql — Course Learning System (ported from sora-spark-forge)
-- Idempotent: safe to re-run. Tables: courses, course_sections, lessons, course_enrollments.

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  short_description VARCHAR(500),
  thumbnail_url TEXT,
  instructor_name VARCHAR(255),
  instructor_avatar TEXT,
  difficulty VARCHAR(50) DEFAULT 'beginner',
  duration_hours INTEGER DEFAULT 0,
  total_lessons INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  price INTEGER DEFAULT 0,
  discount_price INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course_sections (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  section_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES course_sections(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  youtube_url TEXT NOT NULL,
  youtube_id VARCHAR(50),
  duration_minutes INTEGER DEFAULT 0,
  lesson_order INTEGER NOT NULL,
  is_preview BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending',
  rejection_reason TEXT,
  slip_url TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  progress_percent NUMERIC(5,2) DEFAULT 0,
  completed_lessons INTEGER[] DEFAULT '{}',
  last_lesson_id INTEGER,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_courses_slug ON courses(slug);
CREATE INDEX IF NOT EXISTS idx_courses_is_active ON courses(is_active);
CREATE INDEX IF NOT EXISTS idx_courses_is_featured ON courses(is_featured);
CREATE INDEX IF NOT EXISTS idx_sections_course_id ON course_sections(course_id);
CREATE INDEX IF NOT EXISTS idx_sections_order ON course_sections(course_id, section_order);
CREATE INDEX IF NOT EXISTS idx_lessons_course_id ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_section_id ON lessons(section_id);
CREATE INDEX IF NOT EXISTS idx_lessons_order ON lessons(course_id, lesson_order);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON course_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON course_enrollments(status);
