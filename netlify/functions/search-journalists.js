// =====================================================
// NETLIFY FUNCTION: search-journalists
// Ricerca giornalisti nel database per settore
// =====================================================

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  // Solo POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { sector, authToken } = JSON.parse(event.body);

    if (!sector) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Sector parameter required' })
      };
    }

    // Init Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Verifica utente
    const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
    
    if (authError || !user) {
      return {
        statusCode: 401,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    // Carica profilo per verificare piano
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Profile not found' })
      };
    }

    // Query giornalisti per settore
    const { data: journalists, error: searchError } = await supabase
      .from('journalists')
      .select('*')
      .or(`sector.eq.${sector},sector.ilike.%${sector}%`)
      .limit(50);

    if (searchError) {
      console.error('Search error:', searchError);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Search failed' })
      };
    }

    // Filtra i contatti in base al piano
    // Trial: solo nome testata
    // Starter (€149): nome + email
    // Professional (€249): nome + email + telefono
    // Business (€399): nome + email + telefono + rassegna stampa (gestita lato frontend)
    const plan = profile.plan || 'trial';
    const showEmail = ['starter', 'professional', 'business'].includes(plan);
    const showPhone = ['professional', 'business'].includes(plan);

    const results = journalists.map(j => ({
      id: j.id,
      name: j.name,
      outlet: j.outlet,
      sector: j.sector,
      email: showEmail ? j.email : null,
      phone: showPhone ? j.phone : null,
      locked: !showEmail
    }));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        results: results,
        count: results.length,
        plan: profile.plan
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
