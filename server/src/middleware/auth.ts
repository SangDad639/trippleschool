import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Validate JWT_SECRET at module load time
if (!process.env.JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET environment variable is not set!');
  console.error('   Server cannot start without JWT_SECRET.');
  process.exit(1);
}
export const JWT_SECRET: string = process.env.JWT_SECRET;

export interface AuthRequest extends Request {
  userId?: number;
  userEmail?: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  /** จัดการคลิปคู่มือได้อย่างเดียว — ไม่ใช่แอดมินเต็มระบบ */
  isGuideAdmin?: boolean;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
      email: string;
      isAdmin: boolean;
      isSuperAdmin?: boolean;
      isGuideAdmin?: boolean;
    };

    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.isAdmin = decoded.isAdmin;
    req.isSuperAdmin = !!decoded.isSuperAdmin;
    req.isGuideAdmin = !!decoded.isGuideAdmin;

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Like `authenticate`, but never rejects: if a valid Bearer token is present we
 * populate req.userId/isAdmin; otherwise the request continues as anonymous.
 * Used by public list endpoints that must still reveal owner-only fields
 * (e.g. paid-lesson youtube_id) to admins / enrolled owners.
 */
export const optionalAuth = (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        userId: number;
        email: string;
        isAdmin: boolean;
        isSuperAdmin?: boolean;
        isGuideAdmin?: boolean;
      };
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
      req.isAdmin = decoded.isAdmin;
      req.isSuperAdmin = !!decoded.isSuperAdmin;
      req.isGuideAdmin = !!decoded.isGuideAdmin;
    }
  } catch {
    // Invalid/expired token → treat as anonymous (do not reject).
  }
  next();
};

/**
 * Like `authenticate`, but also accepts the JWT via a `?token=` query param.
 * Needed for protected media proxies loaded through <img>/<a> tags, which
 * cannot set an Authorization header. Populates the same req claims.
 */
export const authenticateQueryOrHeader = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const headerToken = req.headers.authorization?.replace('Bearer ', '');
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const token = headerToken || queryToken;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
      email: string;
      isAdmin: boolean;
      isSuperAdmin?: boolean;
      isGuideAdmin?: boolean;
    };
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.isAdmin = decoded.isAdmin;
    req.isSuperAdmin = !!decoded.isSuperAdmin;
    req.isGuideAdmin = !!decoded.isGuideAdmin;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Like `optionalAuth`, but also accepts the JWT via a `?token=` query param —
 * for gated media proxies loaded through <a>/<iframe>, which can't set an
 * Authorization header, where the resource may still be fully public (the
 * route itself decides per-resource whether the anonymous fallback is ok).
 */
export const optionalAuthQueryOrHeader = (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const headerToken = req.headers.authorization?.replace('Bearer ', '');
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const token = headerToken || queryToken;
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        userId: number;
        email: string;
        isAdmin: boolean;
        isSuperAdmin?: boolean;
        isGuideAdmin?: boolean;
      };
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
      req.isAdmin = decoded.isAdmin;
      req.isSuperAdmin = !!decoded.isSuperAdmin;
      req.isGuideAdmin = !!decoded.isGuideAdmin;
    }
  } catch {
    // Invalid/expired token → treat as anonymous (do not reject).
  }
  next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
};

/**
 * Guide-clip editors: full admins pass too, so an admin never needs the extra
 * flag. Everything outside /api/guide still requires requireAdmin, which this
 * deliberately does not satisfy.
 */
export const requireGuideAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.isAdmin && !req.isGuideAdmin) {
    return res.status(403).json({ error: 'Guide admin access required' });
  }
  next();
};
