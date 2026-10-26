import express from 'express';
import { verifyToken } from '../middlewares/AuthJWT';
import {
  login,
  logout,
  register,
  requestResetPassword,
  resetPassword,
} from '../controllers/authorization';
import {
  loginRateLimit,
  passwordResetRateLimit,
  passwordResetRequestRateLimit,
} from '../middlewares/AuthRateLimit';

const router = express.Router();

router.post('/login', loginRateLimit, login);
router.post('/register', register);
router.post('/logout', verifyToken, logout);

router.post(
  '/requestResetPassword',
  passwordResetRequestRateLimit,
  requestResetPassword
);
router.post('/resetPassword', passwordResetRateLimit, resetPassword);

export default router;
