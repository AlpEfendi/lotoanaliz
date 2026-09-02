const REPO = 'AlpEfendi/lotoanaliz';
const WORKFLOW = '.github/workflows/loto-sync.yml';
const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export function validRunId(value) {
  return /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value));
}

function runInfo(run) {
  if (!validRunId(run.id)) throw new Error('GitHub işlem numarası alınamadı.');
  return {
    id: Number(run.id), status: run.status, conclusion: run.conclusion || null,
    url: `https://github.com/${REPO}/actions/runs/${run.id}`
  };
}

export async function handleRequest(request, { createClient, getEnv, fetchImpl }) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, error: 'Yalnız POST isteği kabul edilir.' }, 405);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ ok: false, error: 'Yönetici oturumu gerekli.' }, 401);

  const supabaseUrl = getEnv('SUPABASE_URL');
  const publishableKey = getEnv('SUPABASE_ANON_KEY');
  const githubToken = getEnv('GITHUB_ACTIONS_TOKEN');
  if (!supabaseUrl || !publishableKey || !githubToken) {
    return json({ ok: false, error: 'Sunucu otomasyonu yapılandırılmamış.' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Geçersiz istek.' }, 400); }
  const action = body?.action || 'start'; // Eski site sürümüyle uyumluluk.
  if (!['start', 'status'].includes(action) || (action === 'status' && !validRunId(body.run_id))) {
    return json({ ok: false, error: 'Geçersiz işlem veya işlem numarası.' }, 400);
  }

  try {
    const supabase = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, error: 'Oturum doğrulanamadı.' }, 401);
    const { data: isAdmin, error: adminError } = await supabase.rpc('is_loto_admin');
    if (adminError || isAdmin !== true) return json({ ok: false, error: 'Bu işlem için loto yöneticisi yetkisi gerekli.' }, 403);

    async function github(path, options = {}) {
      const response = await fetchImpl(`https://api.github.com/repos/${REPO}/${path}`, {
        ...options,
        headers: {
          Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken}`,
          'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'lotoanaliz-supabase-function'
        },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`GitHub işlem bilgisi alınamadı (${response.status}).`);
      return response.json();
    }

    if (action === 'status') {
      const run = await github(`actions/runs/${body.run_id}`);
      if (run.path !== WORKFLOW || run.head_branch !== 'main') {
        return json({ ok: false, error: 'İşlem loto eşitlemesine ait değil.' }, 404);
      }
      const info = runInfo(run);
      if (run.status === 'completed' && run.conclusion === 'success') {
        const { count, error } = await supabase.from('loto_sync_conflicts')
          .select('id', { count: 'exact', head: true }).is('resolved_at', null);
        if (error) throw new Error('Çakışma bilgisi alınamadı.');
        info.unresolved_conflicts = count || 0;
      }
      if (run.status === 'in_progress' || (run.status === 'completed' && run.conclusion !== 'success')) {
        const { jobs = [] } = await github(`actions/runs/${body.run_id}/jobs?per_page=100`);
        const steps = jobs.flatMap(job => job.steps || []);
        const step = steps.find(item => item.conclusion && !['success', 'skipped'].includes(item.conclusion))
          || steps.find(item => item.status === 'in_progress');
        info.step = step?.name || null;
      }
      return json({ ok: true, run: info });
    }

    // Yenileme/başka kategori/ikinci tıklama, süren işi tekrar kuyruğa eklemez.
    const { workflow_runs = [] } = await github('actions/workflows/loto-sync.yml/runs?branch=main&per_page=30');
    const active = workflow_runs.find(run => ACTIVE_STATUSES.has(run.status) && run.head_branch === 'main');
    if (active) return json({ ok: true, reused: true, run: runInfo(active) }, 202);

    // 2026-03-10 API sürümü tetiklenen çalışmanın kesin kimliğini döndürür.
    const dispatched = await github('actions/workflows/loto-sync.yml/dispatches', {
      method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { months_back: '1' } })
    });
    return json({ ok: true, reused: false, run: runInfo({ id: dispatched.workflow_run_id, status: 'queued' }) }, 202);
  } catch (error) {
    // Dış servis yanıt gövdeleri/anahtarlar tarayıcıya veya loga aktarılmaz.
    const message = error?.name === 'TimeoutError'
      ? 'GitHub yanıtı gecikti; işlem durumunu yeniden kontrol edin.'
      : error?.message?.startsWith('GitHub ') ? error.message : 'İşlem durumu şu anda alınamıyor.';
    return json({ ok: false, error: message }, 502);
  }
}
