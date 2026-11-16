import type { APIRoute } from 'astro';
import { getCatalogue } from '../lib/npm';

/** The whole catalogue as JSON, for tools and runtimes that want to read it. */
export const GET: APIRoute = async () => {
  const { agents, ecosystem, fetchedAt } = await getCatalogue();
  // The README is for the package's page. It is long, and npm has it already.
  const listed = agents.map(({ readme: _readme, ...agent }) => agent);
  return new Response(JSON.stringify({ fetchedAt, agents: listed, ecosystem }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
