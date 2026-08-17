// Pure validators. Small, and used only by the admin route.
export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
export const isPositive = (n) => Number.isFinite(n) && n > 0;
export const required = (v) => v != null && v !== '';
