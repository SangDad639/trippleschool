import express, { Request, Response } from 'express';

const router = express.Router();

router.post('/unlock', async (req: Request, res: Response) => {
  try {
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Password required' });
    }
    const expected = process.env.TUTORIAL_UNLOCK_PASSWORD || '';
    if (!expected) {
      return res.status(500).json({ success: false, error: 'Tutorial password not configured' });
    }
    if (password.trim() !== expected) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
});

export default router;
