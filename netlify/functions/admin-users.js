// =====================================================
// NETLIFY FUNCTION: admin-users
// Gestione admin utenti Press AI
// Accesso riservato: verifica email admin server-side
// =====================================================

const { createClient } = require('@supabase/supabase-js');

const ADMIN_EMAIL = 'sandramanzi@mediacomunikiamo.it';

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action, adminEmail, userId } = body;

  // Verifica server-side che sia l'admin
  if (adminEmail !== ADMIN_EMAIL) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Accesso non autorizzato' }) };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    if (action === 'list_users') {
      const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
      if (error) throw error;
      // Restituisce solo i dati necessari (no password hash)
      const users = data.users.map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        user_metadata: u.user_metadata || {}
      }));
      return {
        statusCode: 200,
        body: JSON.stringify({ users })
      };
    }

    if (action === 'get_user') {
      if (!userId) return { statusCode: 400, body: JSON.stringify({ error: 'userId richiesto' }) };
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error) throw error;
      return {
        statusCode: 200,
        body: JSON.stringify({
          user: {
            id: data.user.id,
            email: data.user.email,
            created_at: data.user.created_at,
            last_sign_in_at: data.user.last_sign_in_at,
            user_metadata: data.user.user_metadata || {}
          }
        })
      };
    }

    if (action === 'reset_trial') {
      if (!userId) return { statusCode: 400, body: JSON.stringify({ error: 'userId richiesto' }) };
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 7);
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          plan: 'trial',
          trial_end_date: trialEnd.toISOString(),
          credits_used: 0,
          trial_completed: false
        }
      });
      if (error) throw error;
      console.log(`[ADMIN] ${adminEmail} reset trial for user ${userId} at ${new Date().toISOString()}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Azione non riconosciuta' }) };

  } catch(e) {
    console.error('Admin function error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
