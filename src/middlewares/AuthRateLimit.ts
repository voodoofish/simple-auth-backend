import { rateLimit } from 'express-rate-limit';

const createAuthRateLimiter = (limit: number, windowMs: number) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
    },
  });

export const loginRateLimit = createAuthRateLimiter(10, 15 * 60 * 1000);
export const passwordResetRequestRateLimit = createAuthRateLimiter(
  5,
  60 * 60 * 1000
);
export const passwordResetRateLimit = createAuthRateLimiter(
  10,
  15 * 60 * 1000
);
