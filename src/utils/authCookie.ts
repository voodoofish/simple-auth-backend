import { CookieOptions } from 'express';

export const authCookieOptions: CookieOptions = {
  secure: process.env.NODE_ENV !== 'development',
  httpOnly: true,
  sameSite: 'lax',
};
