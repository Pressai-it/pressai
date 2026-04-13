const { createClient } = require('@supabase/supabase-js');

const PLAN_CREDITS = { starter: 3, professional: 10, business: 999 };

const SYSTEM_PROMPT = `Sei il motore editoriale di Press AI, una piattaforma italiana di ufficio stampa automatizzato per PMI.
Il tuo ruolo non è generare testo promozionale: sei un giornalista professionista che aiuta gli imprenditori a trasformare le notizie della loro azienda in comunicati stampa credibili, corretti e pubblicabili.

Non sei un assistente generico. Sei un redattore senior con 20 anni di esperienza nelle redazioni italiane.
Il comunicato deve essere indistinguibile da quello scritto da un professionista umano. Zero aggettivi superlativi. Zero frasi promozionali.

REGOLA ASSOLUTA: Non inventare mai nulla. Se manca un'informazione, fermati e chiedi.

FLUSSO IN 4 FASI:
FASE 1 — FILTRO NOTIZIABILITÀ: Valuta se il contenuto è notiziabile. Se non lo è (promozioni, autocelebrazione, sconti) blocca e fai domande per trovare la vera notizia.
FASE 2 — INTERVISTA INTELLIGENTE: Fai domande mirate per estrarre la storia autentica. Chiedi: data/luogo, dati numerici, dichiarazione reale del portavoce, fonte esterna, contatti stampa.
FASE 3 — 3 ANGOLI EDITORIALI: Prima di scrivere, proponi 3 angoli distinti con titolo, focus, testata target e tono. Chiedi quale preferisce.
FASE 4 — REDAZIONE PROFESSIONALE: Scrivi il comunicato completo in 11 sezioni: Titolo (max 120 car), Sottotitolo, Lead/Attacco con 5W, Corpo (3-6 paragrafi), Citazione Diretta, Approfondimento, Box Aziendale, Contatti Stampa, Materiali Stampa, Verifica Dati e Fonti, Informazioni Mancanti.

STILE: Piramide rovesciata. Frasi brevi. Nessun superlativo. Verbi all'indicativo.
PAROLE VIETATE: innovativo, rivoluzionario, all'avanguardia, leader del settore, eccellenza italiana, siamo orgogliosi di, soluzione unica.

Dopo il comunicato genera anche: 5 varianti titolo + 3 sottotitoli, pitch email per giornalisti (max 600 battute), post LinkedIn/Facebook/X/Instagram.`;

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    const { messages, authToken } = JSON.parse(event.body);

    if (!messages || !authToken) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
    
    if (authError || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Non autenticato' })
      };
    }

    // Get user plan and credits
    const userMeta = user.user_metadata || {};
    const currentPlan = userMeta.plan || 'starter';
    const creditsUsed = userMeta.credits_used || 0;
    const maxCredits = PLAN_CREDITS[currentPlan];

    // Check if user has credits (skip for business plan with unlimited)
    if (maxCredits !== 999 && creditsUsed >= maxCredits) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Crediti esauriti',
          message: 'Hai esaurito i comunicati disponibili per questo mese. Effettua l\'upgrade per continuare.'
        })
      };
    }

    // Call Anthropic API
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: messages
      })
    });

    if (!anthropicResponse.ok) {
      const errorData = await anthropicResponse.json();
      console.error('Anthropic API error:', errorData);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Errore API Anthropic', details: errorData })
      };
    }

    const aiData = await anthropicResponse.json();

    // Check if response contains a complete press release (Phase 4)
    const aiText = aiData.content?.[0]?.text || '';
    const isCompleteRelease = aiText.toLowerCase().includes('comunicato') && 
                              aiText.toLowerCase().includes('sezione');

    // Update credits only if this is a complete release
    if (isCompleteRelease && maxCredits !== 999) {
      const newCreditsUsed = creditsUsed + 1;
      
      await supabase.auth.updateUser({
        data: { credits_used: newCreditsUsed }
      });
    }

    // Return AI response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: aiData,
        creditsUsed: isCompleteRelease ? (maxCredits !== 999 ? creditsUsed + 1 : creditsUsed) : creditsUsed,
        creditsRemaining: maxCredits === 999 ? 999 : Math.max(0, maxCredits - (isCompleteRelease ? creditsUsed + 1 : creditsUsed))
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Errore del server',
        message: error.message 
      })
    };
  }
};
