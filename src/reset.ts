import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');
const files = ['makoto.db', 'makoto.db-wal', 'makoto.db-shm'];
let removed = 0;

for (const file of files) {
  const target = path.join(dataDir, file);
  try {
    fs.unlinkSync(target);
    removed += 1;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') continue;
    if (code === 'EBUSY' || code === 'EPERM') {
      console.error('The database is currently in use. Stop the server (Ctrl+C) and run "npm run reset" again.');
      process.exit(1);
    }
    throw error;
  }
}

console.log(
  removed
    ? 'Database reset. Run "npm start" to recreate and reseed it.'
    : 'No database found. Run "npm start" to create it.'
);
