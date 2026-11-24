import { Request, Response, NextFunction } from 'express';
import { ErrorHandler } from './ErrorHandler';

export const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173, http://localhost:5173 , moz-extension://902ee054-1adf-4e18-b4f0-c61616a85940')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export const verifyRequestOrigin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const origin = req.get('origin');

  if (!safeMethods.has(req.method) && origin && !clientOrigins.includes(origin)) {
    return next(new ErrorHandler(403, 'Request origin not allowed'));
  }

  return next();
};
