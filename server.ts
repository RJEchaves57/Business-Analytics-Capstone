import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';

import { migrate } from './src/db';
import { seedIfEmpty } from './src/seed';
import { handleApi } from './src/api';
import { SESSION_COOKIE, getSession } from './src/auth';
import { parseCookies, AppError } from './src/util';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = process.env.MAKOTO_ROOT || process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');

migrate();
const seeded = seedIfEmpty();

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const url = new URL(req.originalUrl, `http://${req.headers.host || 'localhost'}`);
    const cookies = parseCookies(req.headers.cookie);
    const session = getSession(cookies[SESSION_COOKIE]);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    await handleApi(req, res, url, body, session, ip);
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* React build (production)                                            */
/* ------------------------------------------------------------------ */

app.use(
  '/assets',
  express.static(path.join(DIST_DIR, 'assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: true,
  })
);

app.use(
  express.static(DIST_DIR, {
    index: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
  if (!fs.existsSync(INDEX_FILE)) {
    res
      .status(503)
      .type('text/plain')
      .send(
        'The React build is not available. Run "npm run build" first, or use "npm run dev" to start the Vite development server.'
      );
    return;
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(INDEX_FILE, (error) => {
    if (error) next(error);
  });
});

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

app.use((error: HttpError, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status =
    error instanceof AppError ? error.status : Number(error.status || error.statusCode) || 500;
  const message =
    error instanceof AppError
      ? error.message
      : status === 400
        ? 'Invalid request body.'
        : 'Something went wrong on the server.';
  if (status >= 500) console.error(error);
  if (req.originalUrl.startsWith('/api')) {
    res.status(status).json({ error: message });
    return;
  }
  res.status(status).type('text/plain').send(message);
});

export default app;

// Only listen when started directly with `npm start`. When imported by the
// Vercel function, the Express app is exported instead of binding a port.
if (!process.env.VERCEL && require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    const line = '─'.repeat(58);
    console.log(`\n  ${line}`);
    console.log('  MAKOTO METAL TECHNOLOGY, INC.  ·  MEPZ II Operations');
    console.log(`  ${line}`);
    console.log(`  Express API running at  http://${HOST}:${PORT}`);
    console.log(
      `  React build:            ${fs.existsSync(INDEX_FILE) ? 'served from /dist' : 'not built — run npm run build'}`
    );
    if (seeded) {
      console.log('  Demo data loaded.');
      console.log('  Sign in with:      admin / admin123');
      console.log('                     manager / manager123');
      console.log('                     maintenance / maintenance123');
      console.log('                     user / user123');
    }
    console.log('  Development UI:    http://localhost:5173 (npm run dev)');
    console.log(`  ${line}\n`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Set PORT to another value, e.g. PORT=3001 npm start.`);
      process.exit(1);
    }
    throw error;
  });
}
