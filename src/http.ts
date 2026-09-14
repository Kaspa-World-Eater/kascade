/**
 * The two tiny HTTP helpers a JSON node server needs, in one place so the fount (and its siblings)
 * stay focused on what they serve rather than how they read and write a request.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Write a JSON response with the right length header. */
export const json = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

/** Read a request body and parse it as JSON (empty body -> {}). */
export const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (d: Buffer) => parts.push(d));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
