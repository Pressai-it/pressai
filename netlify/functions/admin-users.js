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
    const { action, authToken, targetUserId, page = 1, limit = 50, newPlan } = JSON.parse(event.body);

    const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(authToken);
    if (authError || !user || user.email !== ADMIN_EMAIL) {
      return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Accesso negato' }) };
    }

    try {
      await supabaseAdmin.from('admin_audit_log').insert({
        admin_id: user.id, action, target_user_id: targetUserId || null,
        performed_at: new Date().toISOString(), ip: event.headers['x-forwarded-for'] || 'unknown'
      });
    } catch(e) {}

    // Lista tutti i clienti — arricchita con metadata da auth.users
    if (action === 'list_users') {
      const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: limit });
      
      const enriched = (authUsers || []).map(u => {
        const meta = u.user_metadata || {};
        return {
          id: u.id,
          email: u.email,
          ragione_sociale: meta.ragione_sociale || meta.company_name || '—',
          company_name: meta.company_name || '—',
          phone: meta.phone || '—',
          p_iva: meta.p_iva || '—',
          pec: meta.pec || '—',
          city: meta.city || '—',
          plan: meta.plan || 'trial',
          credits_used: meta.credits_used || 0,
          trial_end_date: meta.trial_end_date || null,
          trial_completed: meta.trial_completed || false,
          press_contact: meta.press_contact || '—',
          created_at: u.created_at
        };
      }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ users: enriched, count: enriched.length }) };
    }

    // Dettaglio singolo cliente
    if (action === 'get_user_detail' && targetUserId) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
      const meta = authUser?.user?.user_metadata || {};
      const { data: releases } = await supabaseAdmin.from('press_releases').select('id, title, created_at, status').eq('user_id', targetUserId).order('created_at', { ascending: false });
      const { data: clippings } = await supabaseAdmin.from('press_clippings').select('*').eq('user_id', targetUserId).order('found_at', { ascending: false }).limit(20);
      
      const profile = {
        id: targetUserId,
        email: authUser?.user?.email,
        ragione_sociale: meta.ragione_sociale || meta.company_name || '—',
        company_name: meta.company_name || '—',
        phone: meta.phone || '—',
        p_iva: meta.p_iva || '—',
        pec: meta.pec || '—',
        city: meta.city || '—',
        indirizzo: meta.indirizzo || '—',
        provincia: meta.provincia || '—',
        cap: meta.cap || '—',
        plan: meta.plan || 'trial',
        credits_used: meta.credits_used || 0,
        trial_end_date: meta.trial_end_date || null,
        trial_completed: meta.trial_completed || false,
        press_contact: meta.press_contact || '—',
        website: meta.website || '—'
      };

      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ profile, email: authUser?.user?.email, releases: releases || [], clippings: clippings || [] }) };
    }

    // Cambia piano
    if (action === 'change_plan' && targetUserId) {
      await supabaseAdmin.auth.admin.updateUserById(targetUserId, { user_metadata: { plan: newPlan } });
      await supabaseAdmin.from('profiles').update({ plan: newPlan }).eq('id', targetUserId);
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true }) };
    }

    // Resetta trial
    if (action === 'reset_trial' && targetUserId) {
      const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabaseAdmin.auth.admin.updateUserById(targetUserId, { user_metadata: { trial_completed: false, credits_used: 0, trial_end_date: trialEnd } });
      await supabaseAdmin.from('profiles').update({ trial_end_date: trialEnd, credits_used: 0 }).eq('id', targetUserId);
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Azione non riconosciuta' }) };

  } catch (error) {
    console.error('Admin error:', error);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: error.message }) };
  }
};
