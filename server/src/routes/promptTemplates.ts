import { Router } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Emails allowed to access prompt manager (non-admin)
const PROMPT_MANAGER_EMAILS = ['basballcmmilk@gmail.com', 'xommon101@gmail.com'];
function canManagePrompts(req: AuthRequest): boolean {
  return !!(req.isAdmin || (req.userEmail && PROMPT_MANAGER_EMAILS.includes(req.userEmail)));
}

// In-memory cache for Sora video URLs (1 hour TTL)
interface SoraCache {
  videoUrl: string | null;
  thumbnailUrl: string | null;
  expires: number;
}
const soraVideoCache = new Map<string, SoraCache>();
const SORA_CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Helper function to extract video ID from URL (YouTube or Sora)
interface VideoInfo {
  type: 'youtube' | 'sora' | null;
  id: string | null;
}

function extractVideoId(url: string): VideoInfo {
  if (!url) return { type: null, id: null };

  // Check for Sora URL: https://sora.chatgpt.com/p/s_xxx
  const soraMatch = url.match(/sora\.chatgpt\.com\/p\/(s_[a-zA-Z0-9]+)/);
  if (soraMatch) {
    return { type: 'sora', id: soraMatch[1] };
  }

  // Check for YouTube URL
  const youtubePatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pattern of youtubePatterns) {
    const match = url.match(pattern);
    if (match) return { type: 'youtube', id: match[1] };
  }

  return { type: null, id: null };
}

// Legacy helper for backward compatibility
function extractYoutubeId(url: string): string | null {
  const info = extractVideoId(url);
  return info.type === 'youtube' ? info.id : null;
}

// Fetch Sora video URL from sora.chatgpt.com page (uses native fetch - no curl dependency)

async function fetchSoraVideoUrl(soraUrl: string): Promise<{ videoUrl: string | null; thumbnailUrl: string | null }> {
  // Check cache first
  const cached = soraVideoCache.get(soraUrl);
  if (cached && Date.now() < cached.expires) {
    console.log('[fetchSoraVideoUrl] Cache hit for:', soraUrl);
    return { videoUrl: cached.videoUrl, thumbnailUrl: cached.thumbnailUrl };
  }

  try {
    // Use native fetch (Node.js 18+) with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(soraUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Extract direct video URL (md/raw = video file) - include \u0026 encoded params
    const videoMatch = html.match(/videos\.openai\.com[^"'\s]*?%2Fdrvs%2Fmd%2Fraw[^"'\s]*/);
    // Fallback: any /raw URL that's not a thumbnail
    const videoFallback = html.match(/videos\.openai\.com[^"'\s]*?%2Fraw[^"'\s]*/);
    // Extract thumbnail URL (link_thumbnail/raw)
    const thumbMatch = html.match(/videos\.openai\.com[^"'\s]*?link_thumbnail%2Fraw[^"'\s]*/);

    const cleanUrl = (raw: string) => `https://${raw.replace(/\\$/g, '').replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\u002F/g, '/')}`;

    const videoUrl = videoMatch ? cleanUrl(videoMatch[0])
                   : videoFallback ? cleanUrl(videoFallback[0])
                   : null;
    const thumbnailUrl = thumbMatch ? cleanUrl(thumbMatch[0]) : null;

    console.log('[fetchSoraVideoUrl] videoUrl:', videoUrl ? 'found' : 'not found', 'thumbnailUrl:', thumbnailUrl ? 'found' : 'not found');

    // Cache the result
    soraVideoCache.set(soraUrl, {
      videoUrl,
      thumbnailUrl,
      expires: Date.now() + SORA_CACHE_TTL
    });

    return { videoUrl, thumbnailUrl };
  } catch (err) {
    console.error('Failed to fetch Sora video URL:', err);
    return { videoUrl: null, thumbnailUrl: null };
  }
}

// Helper function to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// ============================================
// PUBLIC ROUTES
// ============================================

// GET /api/prompt-templates/sora-video - Fetch Sora video URL from sora.chatgpt.com
// Supports optional templateId for persistent DB caching
router.get('/sora-video', async (req, res) => {
  try {
    const { url, templateId } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }
    if (!url.includes('sora.chatgpt.com')) {
      return res.status(400).json({ error: 'Invalid Sora URL' });
    }

    // If templateId provided, check DB cache first (6 hour TTL)
    if (templateId) {
      const cached = await pool.query(
        `SELECT resolved_video_url FROM prompt_library
         WHERE id = $1 AND resolved_video_url IS NOT NULL
         AND video_resolved_at > NOW() - INTERVAL '6 hours'`,
        [templateId]
      );
      if (cached.rows[0]?.resolved_video_url) {
        console.log('[sora-video] DB cache hit for template:', templateId);
        return res.json({ videoUrl: cached.rows[0].resolved_video_url, thumbnailUrl: null, cached: true });
      }
    }

    // Fetch from Sora (uses in-memory cache + async curl)
    const result = await fetchSoraVideoUrl(url);

    // Save to DB if templateId provided and videoUrl found
    if (templateId && result.videoUrl) {
      await pool.query(
        `UPDATE prompt_library SET resolved_video_url = $1, video_resolved_at = NOW() WHERE id = $2`,
        [result.videoUrl, templateId]
      ).catch(err => console.error('[sora-video] Failed to cache to DB:', err));
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching Sora video:', error);
    res.status(500).json({ error: 'Failed to fetch Sora video' });
  }
});

// GET /api/prompt-templates - Get all active prompt templates (supports pagination)
router.get('/', async (req, res) => {
  try {
    const { platform, search, featured, page, limit } = req.query;

    // Build WHERE clause
    let whereClause = `WHERE is_active = true AND user_id IS NULL`;
    const params: any[] = [];
    let paramIndex = 1;

    if (platform) {
      whereClause += ` AND platform = $${paramIndex}`;
      params.push(platform);
      paramIndex++;
    }

    if (featured === 'true') {
      whereClause += ` AND is_featured = true`;
    }

    if (search) {
      whereClause += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const orderClause = `ORDER BY created_at DESC`;

    // If pagination requested
    if (page && limit) {
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
      const offset = (pageNum - 1) * limitNum;

      // Get total count
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM prompt_library ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);

      // Get paginated data
      const dataQuery = `
        SELECT * FROM prompt_library
        ${whereClause}
        ${orderClause}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      const result = await pool.query(dataQuery, [...params, limitNum, offset]);

      return res.json({
        data: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasMore: pageNum * limitNum < total
        }
      });
    }

    // No pagination - return all (backward compatible)
    const query = `SELECT * FROM prompt_library ${whereClause} ${orderClause}`;
    const result = await pool.query(query, params);
    console.log('[promptTemplates] Returning', result.rows.length, 'templates');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching prompt templates:', error);
    res.status(500).json({ error: 'Failed to fetch prompt templates' });
  }
});

// GET /api/prompt-templates/:slug - Get prompt template by slug
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(`
      SELECT * FROM prompt_library WHERE slug = $1 AND is_active = true
    `, [slug]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prompt template not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching prompt template:', error);
    res.status(500).json({ error: 'Failed to fetch prompt template' });
  }
});

// ============================================
// USER ROUTES (requires authentication)
// ============================================

// GET /api/prompt-templates/user/favorites - Get user's favorite prompts
router.get('/user/favorites', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    const result = await pool.query(`
      SELECT pt.*
      FROM prompt_library pt
      INNER JOIN user_prompt_favorites upf ON pt.id = upf.prompt_library_id
      WHERE upf.user_id = $1 AND pt.is_active = true
      ORDER BY upf.created_at DESC
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching favorite prompts:', error);
    res.status(500).json({ error: 'Failed to fetch favorite prompts' });
  }
});

// POST /api/prompt-templates/:id/favorite - Toggle favorite
router.post('/:id/favorite', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Check if already favorited
    const existing = await pool.query(`
      SELECT id FROM user_prompt_favorites
      WHERE user_id = $1 AND prompt_library_id = $2
    `, [userId, id]);

    if (existing.rows.length > 0) {
      // Remove favorite
      await pool.query(`
        DELETE FROM user_prompt_favorites
        WHERE user_id = $1 AND prompt_library_id = $2
      `, [userId, id]);
      res.json({ favorited: false, message: 'Removed from favorites' });
    } else {
      // Add favorite
      await pool.query(`
        INSERT INTO user_prompt_favorites (user_id, prompt_library_id)
        VALUES ($1, $2)
      `, [userId, id]);
      res.json({ favorited: true, message: 'Added to favorites' });
    }
  } catch (error) {
    console.error('Error toggling favorite:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// POST /api/prompt-templates/:id/apply-to-channel/:channelId - Apply prompt to channel
router.post('/:id/apply-to-channel/:channelId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, channelId } = req.params;
    const userId = req.userId;

    // Get the prompt template
    const templateResult = await pool.query(`
      SELECT * FROM prompt_library WHERE id = $1 AND is_active = true
    `, [id]);

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prompt template not found' });
    }

    const template = templateResult.rows[0];

    // Verify channel belongs to user
    const channelResult = await pool.query(`
      SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2
    `, [channelId, userId]);

    if (channelResult.rows.length === 0) {
      return res.status(403).json({ error: 'Channel not found or access denied' });
    }

    // Convert prompt library variables to channel variable format (with values array)
    const existingVars = (template.variables || []).map((v: any) => ({
      name: v.name,
      system_prompt: v.system_prompt || '',
      values: v.values || [],
      loop: v.loop ?? false,
    }));

    // Auto-extract variables from {VAR_NAME} or [VAR_NAME] in prompt template
    const templateText = template.prompt_template || '';
    const curlyMatches = templateText.match(/\{([^}]+)\}/g) || [];
    const squareMatches = templateText.match(/\[([^\]]+)\]/g) || [];
    const allMatches = [...curlyMatches, ...squareMatches];
    const extractedNames = Array.from(new Set(allMatches.map((m: string) => m.replace(/[\{\}\[\]]/g, '')))) as string[];
    const existingNames = new Set(existingVars.map((v: any) => v.name));

    // Add any variables found in template text but not in the variables array
    const channelVariables = [
      ...existingVars,
      ...extractedNames
        .filter((name: string) => !existingNames.has(name))
        .map((name: string) => ({ name, system_prompt: '', values: [], loop: false })),
    ];

    // Update channel with prompt template and variables
    await pool.query(`
      UPDATE scheduler_channels
      SET
        prompt_mode = 'variable',
        prompt_template = $1,
        variables = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [template.prompt_template, JSON.stringify(channelVariables), channelId]);

    // Increment times_used counter
    await pool.query(`
      UPDATE prompt_library
      SET times_used = times_used + 1
      WHERE id = $1
    `, [id]);

    res.json({
      success: true,
      message: 'Prompt template applied to channel successfully'
    });
  } catch (error) {
    console.error('Error applying prompt to channel:', error);
    res.status(500).json({ error: 'Failed to apply prompt to channel' });
  }
});

// Check if user has favorited prompts (for UI)
router.get('/user/check-favorites', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { ids } = req.query;

    if (!ids) {
      return res.json({ favorites: [] });
    }

    const idArray = (ids as string).split(',').map(Number).filter(n => !isNaN(n));

    if (idArray.length === 0) {
      return res.json({ favorites: [] });
    }

    const result = await pool.query(`
      SELECT prompt_library_id FROM user_prompt_favorites
      WHERE user_id = $1 AND prompt_library_id = ANY($2)
    `, [userId, idArray]);

    res.json({
      favorites: result.rows.map(r => r.prompt_library_id)
    });
  } catch (error) {
    console.error('Error checking favorites:', error);
    res.status(500).json({ error: 'Failed to check favorites' });
  }
});

// ============================================
// USER CUSTOM PROMPT ROUTES
// ============================================

// GET /api/prompt-templates/user/custom - Get user's custom prompts
router.get('/user/custom', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM prompt_library WHERE user_id = $1 AND is_active = true
      ORDER BY created_at DESC
    `, [req.userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching custom prompts:', error);
    res.status(500).json({ error: 'Failed to fetch custom prompts' });
  }
});

// POST /api/prompt-templates/user/custom - Create custom prompt
router.post('/user/custom', authenticate, async (req: AuthRequest, res) => {
  try {
    const { name, prompt_template, variables, platform, description, youtube_url, sora_url } = req.body;
    if (!name || !prompt_template) {
      return res.status(400).json({ error: 'Name and prompt_template are required' });
    }
    const slug = generateSlug(name) + '-' + Date.now();
    const result = await pool.query(`
      INSERT INTO prompt_library (name, slug, description, youtube_url, sora_url, prompt_template, variables, platform, user_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      RETURNING *
    `, [name, slug, description || '', youtube_url || '', sora_url || '', prompt_template, JSON.stringify(variables || []), platform || 'sora2', req.userId]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating custom prompt:', error);
    res.status(500).json({ error: 'Failed to create custom prompt' });
  }
});

// PUT /api/prompt-templates/user/custom/:id - Update custom prompt
router.put('/user/custom/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { name, prompt_template, variables, platform, description, youtube_url, sora_url } = req.body;
    const result = await pool.query(`
      UPDATE prompt_library SET name = $1, prompt_template = $2, variables = $3, platform = $4, description = $5, youtube_url = $6, sora_url = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND user_id = $9
      RETURNING *
    `, [name, prompt_template, JSON.stringify(variables || []), platform || 'sora2', description || '', youtube_url || '', sora_url || '', req.params.id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating custom prompt:', error);
    res.status(500).json({ error: 'Failed to update custom prompt' });
  }
});

// DELETE /api/prompt-templates/user/custom/:id - Delete custom prompt
router.delete('/user/custom/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM prompt_library WHERE id = $1 AND user_id = $2 RETURNING id
    `, [req.params.id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting custom prompt:', error);
    res.status(500).json({ error: 'Failed to delete custom prompt' });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

// GET /api/prompt-templates/admin/all - Get all prompt templates (admin only)
router.get('/admin/all', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!canManagePrompts(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query(`
      SELECT * FROM prompt_library
      ORDER BY display_order ASC, created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all prompt templates:', error);
    res.status(500).json({ error: 'Failed to fetch prompt templates' });
  }
});

// POST /api/prompt-templates/admin - Create prompt template (admin only)
router.post('/admin', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!canManagePrompts(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const {
      name,
      slug: providedSlug,
      description,
      youtube_url,
      sora_url,
      thumbnail_url,
      platform,
      prompt_template,
      variables,
      is_featured,
      is_active,
      display_order,
      extend_prompt_template,
      extend_variables,
      grok_url,
      yearly_only
    } = req.body;

    if (!name || !prompt_template) {
      return res.status(400).json({ error: 'Name and prompt_template are required' });
    }

    // Generate or use provided slug
    const slug = providedSlug || generateSlug(name);

    // Extract YouTube ID
    const youtube_id = extractYoutubeId(youtube_url);

    // Auto-generate thumbnail from YouTube if not provided
    const finalThumbnail = thumbnail_url || (youtube_id ? `https://img.youtube.com/vi/${youtube_id}/maxresdefault.jpg` : null);

    const result = await pool.query(`
      INSERT INTO prompt_library (
        name, slug, description, youtube_url, sora_url, youtube_id, thumbnail_url,
        platform, prompt_template, variables, is_featured, is_active, display_order, extend_prompt_template, extend_variables, grok_url, yearly_only
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      name,
      slug,
      description || null,
      youtube_url || null,
      sora_url || null,
      youtube_id,
      finalThumbnail,
      platform || 'sora2',
      prompt_template,
      JSON.stringify(variables || []),
      is_featured || false,
      is_active !== false,
      display_order || 0,
      extend_prompt_template || null,
      JSON.stringify(extend_variables || []),
      grok_url || null,
      yearly_only || false
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error('Error creating prompt template:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A prompt template with this slug already exists' });
    }
    res.status(500).json({ error: 'Failed to create prompt template' });
  }
});

// PUT /api/prompt-templates/admin/:id - Update prompt template (admin only)
router.put('/admin/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!canManagePrompts(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const {
      name,
      slug,
      description,
      youtube_url,
      sora_url,
      thumbnail_url,
      platform,
      prompt_template,
      variables,
      is_featured,
      is_active,
      display_order,
      extend_prompt_template,
      extend_variables,
      grok_url,
      yearly_only
    } = req.body;

    console.log('[promptTemplates] UPDATE id:', id, 'youtube_url:', youtube_url);

    // Extract YouTube ID if URL changed
    const youtube_id = youtube_url ? extractYoutubeId(youtube_url) : null;

    // Auto-generate thumbnail from YouTube if not provided
    const finalThumbnail = thumbnail_url || (youtube_id ? `https://img.youtube.com/vi/${youtube_id}/maxresdefault.jpg` : null);

    const result = await pool.query(`
      UPDATE prompt_library
      SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        description = $3,
        youtube_url = $4,
        sora_url = $5,
        youtube_id = $6,
        thumbnail_url = $7,
        platform = COALESCE($8, platform),
        prompt_template = COALESCE($9, prompt_template),
        variables = COALESCE($10, variables),
        is_featured = COALESCE($11, is_featured),
        is_active = COALESCE($12, is_active),
        display_order = COALESCE($13, display_order),
        extend_prompt_template = $15,
        extend_variables = COALESCE($16, extend_variables),
        grok_url = $17,
        yearly_only = COALESCE($18, yearly_only),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `, [
      name,
      slug,
      description,
      youtube_url,
      sora_url || null,
      youtube_id,
      finalThumbnail,
      platform,
      prompt_template,
      variables ? JSON.stringify(variables) : null,
      is_featured,
      is_active,
      display_order,
      id,
      extend_prompt_template || null,
      extend_variables ? JSON.stringify(extend_variables) : null,
      grok_url || null,
      yearly_only !== undefined ? yearly_only : null
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prompt template not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error updating prompt template:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A prompt template with this slug already exists' });
    }
    res.status(500).json({ error: 'Failed to update prompt template' });
  }
});

// DELETE /api/prompt-templates/admin/:id - Delete prompt template (admin only)
router.delete('/admin/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!canManagePrompts(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;

    // Delete favorites first (due to foreign key constraint)
    await pool.query(`
      DELETE FROM user_prompt_favorites WHERE prompt_library_id = $1
    `, [id]);

    // Delete prompt template
    const result = await pool.query(`
      DELETE FROM prompt_library WHERE id = $1 RETURNING id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prompt template not found' });
    }

    res.json({ success: true, message: 'Prompt template deleted' });
  } catch (error) {
    console.error('Error deleting prompt template:', error);
    res.status(500).json({ error: 'Failed to delete prompt template' });
  }
});

export default router;
