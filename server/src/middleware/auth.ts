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
    };

    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.isAdmin = decoded.isAdmin;
    req.isSuperAdmin = !!decoded.isSuperAdmin;

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
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
