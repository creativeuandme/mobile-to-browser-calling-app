import rateLimit from 'express-rate-limit';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // max 200 requests per window
  message: { error: 'Too many authentication attempts. Please try again later.' }
});

export const tokenValidationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // max 30 link validation attempts
  message: { valid: false, reason: 'Too many calling link requests. Please wait a moment.' }
});

export const callInitiateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // max 5 calls initiated per minute per IP
  message: { error: 'Call rate limit exceeded. Please wait a minute before calling again.' }
});
