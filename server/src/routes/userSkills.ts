/**
 * User Skills routes — CRUD + template fork.
 *
 *   GET    /api/skills                  — list current user's skills
 *   POST   /api/skills                  — create a new skill from markdown
 *   GET    /api/skills/:id              — read one skill
 *   PATCH  /api/skills/:id              — update name/description/content/is_default
 *   DELETE /api/skills/:id              — delete a skill
 *
 *   GET    /api/skills/templates        — list built-in starter templates
 *   POST   /api/skills/templates/:id/fork — fork a template into user library
 */
import express, { Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import {
  listUserSkills,
  getUserSkill,
  createUserSkill,
  updateUserSkill,
  deleteUserSkill,
  listSkillTemplates,
  forkTemplate,
} from '../services/skillsService.js';

const router = express.Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const skills = await listUserSkills(req.userId!);
    res.json({ items: skills });
  } catch (err: any) {
    console.error('[userSkills:list]', err);
    res.status(500).json({ error: err?.message || 'List failed' });
  }
});

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, content_md, is_default } = req.body as {
      name?: string;
      description?: string;
      content_md?: string;
      is_default?: boolean;
    };
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    if (!content_md || !content_md.trim()) {
      return res.status(400).json({ error: 'content_md is required' });
    }
    const skill = await createUserSkill(req.userId!, {
      name: name.trim(),
      description: description?.trim() || null,
      content_md,
      is_default: !!is_default,
    });
    res.json({ skill });
  } catch (err: any) {
    if (err.code === '23505') {
      // unique violation on (user_id, name)
      return res.status(409).json({ error: 'A skill with that name already exists' });
    }
    console.error('[userSkills:create]', err);
    res.status(500).json({ error: err?.message || 'Create failed' });
  }
});

router.get('/templates', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const items = await listSkillTemplates();
    res.json({ items });
  } catch (err: any) {
    console.error('[userSkills:listTemplates]', err);
    res.status(500).json({ error: err?.message || 'List templates failed' });
  }
});

router.post('/templates/:id/fork', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid template id' });
    const overrideName = (req.body?.name as string | undefined)?.trim() || undefined;
    const skill = await forkTemplate(req.userId!, id, overrideName);
    res.json({ skill });
  } catch (err: any) {
    console.error('[userSkills:fork]', err);
    res.status(500).json({ error: err?.message || 'Fork failed' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const skill = await getUserSkill(req.userId!, id);
    if (!skill) return res.status(404).json({ error: 'not found' });
    res.json({ skill });
  } catch (err: any) {
    console.error('[userSkills:get]', err);
    res.status(500).json({ error: err?.message || 'Get failed' });
  }
});

router.patch('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const { name, description, content_md, is_default } = req.body as {
      name?: string;
      description?: string;
      content_md?: string;
      is_default?: boolean;
    };
    const updated = await updateUserSkill(req.userId!, id, {
      name,
      description,
      content_md,
      is_default,
    });
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json({ skill: updated });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A skill with that name already exists' });
    }
    console.error('[userSkills:update]', err);
    res.status(500).json({ error: err?.message || 'Update failed' });
  }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const ok = await deleteUserSkill(req.userId!, id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[userSkills:delete]', err);
    res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

export default router;
