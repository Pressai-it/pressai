// Netlify Function: register-user
// Registra l'utente e salva TUTTI i dati in profiles
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { email, password, company_name, phone, website, press_contact,
            p_iva, ragione_sociale, indirizzo, city, provincia, cap, pec } = body;

    const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
    const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // 1. Registra l'utente
    const { data: signUpData, error: signUpError } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: {
        data: {
          company_name, phone, website, press_contact: press_contact || company_name,
          p_iva, ragione_sociale, indirizzo, city, provincia, cap, pec,
          plan: 'trial', credits_used: 0,
          trial_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }
      }
    });

    if (signUpError) {
      return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: signUpError.message }) };
    }

    const userId = signUpData.user?.id;
    if (!userId) {
      return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Utente non creato' }) };
    }

    // 2. Salva tutti i dati in profiles con service role
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from('profiles').upsert({
      id: userId,
      company_name,
      ragione_sociale,
      phone,
      website,
      press_contact: press_contact || company_name,
      p_iva,
      pec,
      indirizzo,
      city,
      provincia,
      cap,
      plan: 'trial',
      credits_used: 0,
      trial_end_date: trialEnd,
      created_at: new Date().toISOString()
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, userId })
    };

  } catch (error) {
    console.error('Register error:', error);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: error.message }) };
  }
};
