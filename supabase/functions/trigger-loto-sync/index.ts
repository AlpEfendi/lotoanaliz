import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, error: 'Yalnız POST isteği kabul edilir.' }, 405);

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ ok: false, error: 'Yönetici oturumu gerekli.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const githubToken = Deno.env.get('GITHUB_ACTIONS_TOKEN');
  if (!supabaseUrl || !publishableKey || !githubToken) {
    return json({ ok: false, error: 'Sunucu otomasyonu yapılandırılmamış.' }, 503);
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ ok: false, error: 'Oturum doğrulanamadı.' }, 401);

  const { data: isAdmin, error: adminError } = await supabase.rpc('is_loto_admin');
  if (adminError || isAdmin !== true) return json({ ok: false, error: 'Bu işlem için loto yöneticisi yetkisi gerekli.' }, 403);

  const githubResponse = await fetch(
    'https://api.github.com/repos/AlpEfendi/lotoanaliz/actions/workflows/loto-sync.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'lotoanaliz-supabase-function'
      },
      body: JSON.stringify({ ref: 'main', inputs: { months_back: '1' } })
    }
  );

  if (!githubResponse.ok) {
    const detail = (await githubResponse.text()).slice(0, 500);
    console.error('GitHub workflow dispatch failed', githubResponse.status, detail);
    return json({ ok: false, error: `GitHub otomasyonu başlatılamadı (${githubResponse.status}).` }, 502);
  }

  return json({ ok: true, message: 'Online sonuç kontrolü başlatıldı.' }, 202);
});
