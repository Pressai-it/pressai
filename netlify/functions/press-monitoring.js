// =====================================================
// NETLIFY FUNCTION: press-monitoring
// Cerca articoli online che menzionano l'azienda del cliente
// Salva risultati in Supabase tabella press_clippings
// =====================================================

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { authToken } = JSON.parse(event.body);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
    if (authError || !user) {
      return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const { data: profile } = await supabase.from('profiles').select('plan, ragione_sociale').eq('id', user.id).single();
    if (!profile || profile.plan !== 'business') {
      return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Disponibile solo piano Business' }) };
    }

    const companyName = profile.ragione_sociale || user.user_metadata?.company_name || '';
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Cerca su Google News via SerpAPI
    let newFound = 0;
    const serpApiKey = process.env.SERPAPI_KEY;
    if (serpApiKey && companyName) {
      const query = encodeURIComponent(`"${companyName}"`);
      const serpUrl = `https://serpapi.com/search.json?q=${query}&tbm=nws&num=10&hl=it&gl=it&api_key=${serpApiKey}`;
      try {
        const serpRes = await fetch(serpUrl);
        const serpData = await serpRes.json();
        if (serpData.news_results) {
          for (const article of serpData.news_results) {
            const { data: existing } = await supabase.from('press_clippings').select('id').eq('user_id', user.id).eq('url', article.link).single().catch(() => ({ data: null }));
            if (!existing) {
              await supabase.from('press_clippings').insert({
                user_id: user.id,
                title: article.title,
                source: article.source,
                url: article.link,
                snippet: article.snippet,
                published_at: article.date || new Date().toISOString(),
                company_name: companyName,
                found_at: new Date().toISOString()
              });
              newFound++;
            }
          }
        }
      } catch (e) { console.error('SerpAPI error:', e); }
    }

    // Restituisce tutti i clipping degli ultimi 30 giorni
    const { data: allClippings } = await supabase.from('press_clippings').select('*').eq('user_id', user.id).gte('found_at', thirtyDaysAgo).order('found_at', { ascending: false });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ clippings: allClippings || [], new_found: newFound, company: companyName })
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: error.message }) };
  }
};
