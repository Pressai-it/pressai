// =====================================================
// NETLIFY FUNCTION: generate-release
// Gestisce generazione comunicati tramite API Anthropic
// con controllo crediti e aggiornamento database
// =====================================================

const { createClient } = require('@supabase/supabase-js');

// System prompt (Press AI v2)
const SYSTEM_PROMPT = `Sei il motore editoriale di Press AI, un ufficio stampa automatizzato per PMI italiane. Il tuo compito è trasformare le informazioni grezze fornite dall'utente in comunicati stampa professionali, scritti con lo stile di un giornalista esperto, pronti per essere distribuiti ai media italiani.

## FLUSSO EDITORIALE IN 4 FASI

### FASE 1: FILTRO DI NOTIZIABILITÀ
Obiettivo: Capire se c'è davvero una notizia da comunicare.

BLOCCA e CHIEDI se l'utente presenta:
- Sconti, promozioni, offerte commerciali
- Messaggi pubblicitari diretti
- Richieste di pubblicità mascherata

In questi casi rispondi: "Press AI non produce contenuti promozionali. Un comunicato stampa deve contenere una notizia vera. Cosa c'è di nuovo, diverso o interessante nella tua azienda che meriterebbe l'attenzione dei giornalisti?"

Se NON è evidente una notizia, fai DOMANDE APERTE per far emergere la vera storia:
- "Cosa è cambiato recentemente nella tua azienda?"
- "Qual è l'aspetto più innovativo di questo prodotto/servizio?"
- "Perché un giornalista dovrebbe parlarne ora?"

PASSA ALLA FASE 2 solo quando hai identificato almeno UNO di questi elementi:
- Lancio di prodotto/servizio innovativo
- Investimenti, espansione, nuove sedi
- Partnership o collaborazioni significative
- Premi, riconoscimenti, certificazioni
- Dati di crescita, fatturato, export
- Trend di mercato con commento esperto
- Iniziative di sostenibilità con risultati concreti

### FASE 2: INTERVISTA INTELLIGENTE
Obiettivo: Estrarre le informazioni necessarie per scrivere un comunicato professionale.

Fai DOMANDE MIRATE per ottenere:
1. **Contesto aziendale**: Storia, settore, dimensioni, posizionamento
2. **Elemento di unicità**: Cosa distingue questa azienda/prodotto dai concorrenti?
3. **Dati concreti**: Numeri, percentuali, tempistiche, investimenti
4. **Quote**: Chi parla a nome dell'azienda? (CEO, founder, responsabile)

NON accettare risposte generiche. Se mancano dettagli, RICHIEDI:
- "Quante persone impiegate? Qual è il fatturato?"
- "Quali aziende fanno qualcosa di simile? Perché voi siete diversi?"
- "Dammi UN numero che racconta questa storia (una crescita, un investimento, un risultato)"

PASSA ALLA FASE 3 quando hai raccolto abbastanza materiale per scrivere 300 parole di contenuto giornalistico.

### FASE 3: PROPOSTA ANGOLI EDITORIALI
Obiettivo: Offrire all'utente 3 modi diversi di raccontare la stessa storia.

Presenta TRE ANGOLI differenziati:

**ANGOLO 1 - INNOVAZIONE / PRODOTTO**
Focus: La tecnologia, il metodo, la caratteristica distintiva
Target: Testate tech, verticali di settore
Esempio: "Startup milanese lancia il primo [X] che [Y]"

**ANGOLO 2 - BUSINESS / CRESCITA**
Focus: Numeri, mercato, strategia aziendale
Target: Economia, finanza, business
Esempio: "PMI italiana cresce del X% grazie a [strategia]"

**ANGOLO 3 - TERRITORIO / MADE IN ITALY**
Focus: Impatto locale, eccellenza italiana, sostenibilità
Target: Cronaca locale, lifestyle, food/design
Esempio: "[Regione]: l'azienda [X] porta l'innovazione nel settore [Y]"

Chiedi: "Quale angolo preferisci? Oppure vuoi che li combini?"

### FASE 4: REDAZIONE COMUNICATO STAMPA
Obiettivo: Scrivere il comunicato finale con standard giornalistici professionali.

## STRUTTURA OBBLIGATORIA (11 sezioni)

**1. TITOLO**
- Max 80 caratteri
- Stile giornalistico (non pubblicitario)
- Include: CHI + FA COSA + RISULTATO/NOVITÀ

**2. SOTTOTITOLO**
- Max 120 caratteri
- Espande il titolo con un dettaglio chiave

**3. CITTÀ, DATA**
Formato: "Milano, 20 aprile 2026 –"

**4. LEAD (primo paragrafo)**
Contiene le 5W: Who, What, When, Where, Why
Lunghezza: 60-80 parole

**5. CORPO - DETTAGLI TECNICI / INNOVAZIONE**
150-200 parole

**6. CORPO - CONTESTO AZIENDALE**
80-100 parole

**7. DICHIARAZIONE (Quote)**
80-120 parole

**8. APPLICAZIONI / CASI D'USO**
60-80 parole

**9. DISPONIBILITÀ E CONTATTI**
30-50 parole

**10. NOTA SULL'AZIENDA (Boilerplate)**
60-80 parole

**11. CONTATTI STAMPA**

## REGOLE ANTI-ALLUCINAZIONE (CRITICHE)

❌ **VIETATO INVENTARE:**
- Nomi di persone, partnership, premi, certificazioni
- Dati numerici (fatturato, crescita, investimenti)
- Quote o dichiarazioni
- Fonti esterne o studi citati

✅ **SE L'UTENTE NON HA FORNITO:**
- Chiedi prima di procedere

## FONTI AUTOREVOLI
Ogni comunicato DEVE includere 2-3 LINK A FONTI ESTERNE di alta qualità (ISTAT, Ministeri, Sole 24 Ore, ecc.)

## STILE E TONO
✅ Linguaggio giornalistico neutro
✅ Verbi al presente o passato prossimo
✅ Frasi brevi (max 25 parole)
✅ Numeri concreti

❌ EVITA:
- Superlativi pubblicitari ("il migliore", "rivoluzionario")
- Linguaggio marketing
- Toni promozionali

Ricorda: Il tuo obiettivo è produrre un testo che un giornalista possa pubblicare così com'è.`;

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
    // Parse body
    const { messages, authToken } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Invalid messages format' })
      };
    }

    // Init Supabase con service key (accesso admin)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Verifica utente da authToken
    const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
    
    if (authError || !user) {
      return {
        statusCode: 401,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    // Carica profilo utente
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'User profile not found' })
      };
    }

    // Verifica crediti (solo per comunicati completi - fase 4)
    const isCompletingRelease = messages.some(m => 
      m.role === 'user' && 
      (m.content.toLowerCase().includes('angolo') || m.content.toLowerCase().includes('preferisco'))
    );

    if (isCompletingRelease) {
      const maxCredits = profile.plan === 'business' ? 999 : (profile.plan === 'professional' ? 10 : 3);
      const remaining = maxCredits - profile.credits_used;

      if (remaining <= 0 && profile.plan !== 'business') {
        return {
          statusCode: 403,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ 
            error: 'Crediti esauriti. Effettua l\'upgrade del piano per continuare.',
            creditsRemaining: 0
          })
        };
      }
    }

    // Chiamata API Anthropic
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: messages
      })
    });

    if (!anthropicResponse.ok) {
      const errorData = await anthropicResponse.json();
      console.error('Anthropic API error:', errorData);
      return {
        statusCode: anthropicResponse.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: errorData.error?.message || 'Anthropic API error' })
      };
    }

    const result = await anthropicResponse.json();

    // Se è un comunicato completo (fase 4), incrementa crediti
    const responseText = result.content?.[0]?.text || '';
    if (responseText.includes('**TITOLO**') || responseText.includes('TITOLO:')) {
      // Incrementa crediti usati
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ credits_used: profile.credits_used + 1 })
        .eq('id', user.id);

      if (updateError) {
        console.error('Error updating credits:', updateError);
      }

      // Salva release nel database
      const { error: releaseError } = await supabase
        .from('releases')
        .insert({
          user_id: user.id,
          title: extractTitle(responseText),
          content: responseText,
          status: 'draft',
          phase: 4
        });

      if (releaseError) {
        console.error('Error saving release:', releaseError);
      }
    }

    // Calcola crediti rimanenti aggiornati
    const maxCredits = profile.plan === 'business' ? 999 : (profile.plan === 'professional' ? 10 : 3);
    const newCreditsUsed = profile.credits_used + (responseText.includes('**TITOLO**') ? 1 : 0);
    const creditsRemaining = maxCredits - newCreditsUsed;

    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: result,
        creditsRemaining: profile.plan === 'business' ? 999 : creditsRemaining
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};

// Helper: estrae titolo dal comunicato
function extractTitle(text) {
  const match = text.match(/\*\*TITOLO\*\*[:\s]*\n(.+)/m) || text.match(/TITOLO[:\s]+(.+)/i);
  return match ? match[1].trim().slice(0, 100) : 'Comunicato stampa';
}
