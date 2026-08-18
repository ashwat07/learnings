export const title = 'The index that cannot be used';
export const task = `Login looks up users case-insensitively. There IS a unique index on email
(users_email_key) and the query still sequential-scans 50,000 rows. Fix it WITHOUT changing the
query — you only control the schema here.`;
export const passIf = 'no Seq Scan on users, fewer than 20 buffers';
export const query = `SELECT id, email, name FROM users WHERE lower(email) = 'user4242@example.com'`;
export const noSeqScanOn = 'users';
export const maxBuffers = 20;
export const expectRows = 1;
