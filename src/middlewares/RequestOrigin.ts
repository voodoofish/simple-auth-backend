import { Request, Response, NextFunction } from 'express';
import { ErrorHandler } from './ErrorHandler';

const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export const verifyRequestOrigin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const origin = req.get('origin');

  if (!safeMethods.has(req.method) && origin && origin !== clientOrigin) {
    return next(new ErrorHandler(403, 'Request origin not allowed'));
  }

  return next();
};
