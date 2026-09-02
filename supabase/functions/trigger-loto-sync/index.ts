import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.mjs';

Deno.serve(request => handleRequest(request, {
  createClient,
  getEnv: (name: string) => Deno.env.get(name),
  fetchImpl: fetch
}));
