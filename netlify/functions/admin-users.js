// =====================================================
// NETLIFY FUNCTION: admin-users
// Accesso esclusivo Sandra: lista clienti, dettagli, impersonate
// AUDIT LOG per GDPR compliance
// =====================================================

const { createClient } = require('@supabase/supabase-js');

const ADMIN_EMAIL = 'sandramanzi@mediacomunikiamo.it';

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { action, authToken, targetUserId, page = 1, limit = 50 } = JSON.parse(event.body);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    // Verifica che sia Sandra
    const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
    if (authError || !user || user.email !== ADMIN_EMAIL) {
      return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Accesso negato' }) };
    }

    // Audit log
    await supabase.from('admin_audit_log').insert({
      admin_id: user.id,
      action: action,
      target_user_id: targetUserId || null,
      performed_at: new Date().toISOString(),
      ip: event.headers['x-forwarded-for'] || 'unknown'
    }).catch(() => {});

    // ---- AZIONI DISPONIBILI ----

    // Lista tutti i clienti con profilo e statistiche
    if (action === 'list_users') {
      const offset = (page - 1) * limit;
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, ragione_sociale, plan, trial_end_date, credits_used, created_at, p_iva, city')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Arricchisci con email da auth
      const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ page, perPage: limit });
      const emailMap = {};
      authUsers?.forEach(u => { emailMap[u.id] = u.email; });

      const enriched = profiles.map(p => ({ ...p, email: emailMap[p.id] || null }));
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ users: enriched, count: enriched.length }) };
    }

    // Dettaglio singolo cliente: profilo + comunicati + clipping
    if (action === 'get_user_detail' && targetUserId) {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', targetUserId).single();
      const { data: releases } = await supabase.from('press_releases').select('id, title, created_at, status').eq('user_id', targetUserId).order('created_at', { ascending: false });
      const { data: clippings } = await supabase.from('press_clippings').select('*').eq('user_id', targetUserId).order('found_at', { ascending: false }).limit(20);
      const { data: authUser } = await supabase.auth.admin.getUserById(targetUserId);
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ profile, email: authUser?.user?.email, releases: releases || [], clippings: clippings || [] })
      };
    }

    // Cambia piano di un cliente
    if (action === 'change_plan' && targetUserId) {
      const { newPlan } = JSON.parse(event.body);
      const { error } = await supabase.from('profiles').update({ plan: newPlan }).eq('id', targetUserId);
      if (error) throw error;
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true, message: `Piano aggiornato a ${newPlan}` }) };
    }

    // Resetta trial di un cliente
    if (action === 'reset_trial' && targetUserId) {
      const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('profiles').update({ trial_end_date: trialEnd, credits_used: 0 }).eq('id', targetUserId);
      await supabase.auth.admin.updateUserById(targetUserId, { user_metadata: { trial_completed: false, credits_used: 0 } });
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Azione non riconosciuta' }) };

  } catch (error) {
    console.error('Admin error:', error);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: error.message }) };
  }
};
