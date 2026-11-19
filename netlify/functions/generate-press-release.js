// Netlify Function - Proxy sicuro per API Anthropic
// Path: netlify/functions/generate-press-release.js

const fetch = require('node-fetch');

// Data reale di oggi, in ora italiana (es. "19 novembre 2026").
// Viene calcolata dal server a ogni richiesta, così il comunicato
// riporta sempre la data del giorno in cui viene generato.
function dataDiOggi() {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());
}

// Istruzioni sulla data, aggiunte in fondo al prompt di sistema.
// Senza queste righe l'AI non sa che giorno è e scrive una data vecchia.
function istruzioniData(oggi) {
  return `

DATA DI OGGI (OBBLIGATORIA):
Oggi è ${oggi}.
- Nella dateline del comunicato usa SEMPRE ed ESATTAMENTE questa data: CITTÀ (PROV), ${oggi} –
- Non usare mai un'altra data per la dateline e non scrivere date passate come se fossero quella di oggi.
- Le espressioni "oggi", "quest'anno", "lo scorso anno", "il mese prossimo" vanno calcolate rispetto a questa data.
- Per le date di eventi, lanci o scadenze usa solo quelle fornite dall'utente: se mancano, chiedile, non inventarle.`;
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { messages, system } = JSON.parse(event.body);

    // Prompt di sistema inviato dalla pagina + data reale di oggi
    const systemConData = (typeof system === 'string' ? system : '') + istruzioniData(dataDiOggi());

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemConData,
        messages: messages
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: errorData.error?.message || 'Errore API Anthropic' 
        })
      };
    }

    const result = await response.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Errore interno del server: ' + error.message 
      })
    };
  }
};
