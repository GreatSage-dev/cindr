import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from '../src/api/routes.js';
import { createBlazeContext } from '../src/server.js';

const defaultContext = createBlazeContext();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleRequest(req, res, defaultContext);
}
