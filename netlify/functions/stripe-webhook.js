// =====================================================
// NETLIFY FUNCTION: stripe-webhook
// Gestisce eventi Stripe e aggiorna profili utenti
// =====================================================

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // Solo POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const payload = JSON.parse(event.body);
    
    // Init Supabase con service key
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Gestisci evento checkout.session.completed
    if (payload.type === 'checkout.session.completed') {
      const session = payload.data.object;
      const customerEmail = session.customer_details?.email;
      
      if (!customerEmail) {
        console.error('No customer email in session');
        return { statusCode: 400, body: JSON.stringify({ error: 'No email' }) };
      }

      // Determina piano dal metadata o amount
      let plan = 'starter';
      if (session.metadata?.plan) {
        plan = session.metadata.plan;
      } else {
        const amount = session.amount_total / 100; // centesimi -> euro
        if (amount >= 399) plan = 'business';
        else if (amount >= 249) plan = 'professional';
      }

      // Trova utente per email
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', customerEmail)
        .single();

      if (existingUser) {
        // Aggiorna profilo esistente
        await supabase
          .from('profiles')
          .update({ 
            plan: plan,
            stripe_customer_id: session.customer,
            credits_used: 0
          })
          .eq('id', existingUser.id);
        
        console.log(`Updated existing user ${customerEmail} to plan ${plan}`);
      } else {
        // Crea nuovo utente (signup tramite Stripe)
        const { data: newUser, error: signUpError } = await supabase.auth.admin.createUser({
          email: customerEmail,
          email_confirm: true
        });

        if (signUpError) {
          console.error('Error creating user:', signUpError);
          return { statusCode: 500, body: JSON.stringify({ error: signUpError.message }) };
        }

        // Crea profilo
        await supabase
          .from('profiles')
          .insert({
            id: newUser.user.id,
            email: customerEmail,
            plan: plan,
            stripe_customer_id: session.customer,
            credits_used: 0
          });

        console.log(`Created new user ${customerEmail} with plan ${plan}`);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, email: customerEmail, plan: plan })
      };
    }

    // Altri eventi Stripe (subscription.updated, etc.)
    console.log('Unhandled event type:', payload.type);
    return {
      statusCode: 200,
      body: JSON.stringify({ received: true })
    };

  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
