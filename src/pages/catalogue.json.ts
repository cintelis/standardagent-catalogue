import type { APIRoute } from 'astro';
import { getCatalogue } from '../lib/npm';

/** The whole catalogue as JSON, for tools and runtimes that want to read it. */
export const GET: APIRoute = async () => {
  const { agents, ecosystem, fetchedAt } = await getCatalogue();
  return new Response(JSON.stringify({ fetchedAt, agents, ecosystem }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
