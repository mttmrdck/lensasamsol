// Prints a random 32-byte base64 key for TOKEN_ENCRYPTION_KEY.
import { randomBytes } from 'node:crypto';

console.log(randomBytes(32).toString('base64'));
