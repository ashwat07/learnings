import { b } from './cycle-b.mjs';
export const a = 'A';
export const fromB = () => b;
