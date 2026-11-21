import type { IncomingMessage, ServerResponse } from 'node:http';
import { createBlazeContext, handleBlazeHttpRequest } from '../src/server.js';

const defaultContext = createBlazeContext();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleBlazeHttpRequest(req, res, defaultContext);
}
