// Temporary one-time setup function — delete after use
import Stripe from 'npm:stripe@17.7.0';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (!stripeSecretKey) {
        return Response.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500, headers: corsHeaders });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    try {
        // List existing webhook endpoints to avoid duplicates
        const existing = await stripe.webhookEndpoints.list({ limit: 100 });
        const webhookUrl = 'https://gypznlmfkarzgzfbqhks.supabase.co/functions/v1/stripe-webhook';
        const found = existing.data.find((wh: any) => wh.url === webhookUrl);

        if (found) {
            // Already exists — but we can't retrieve the secret again. Delete and recreate.
            await stripe.webhookEndpoints.del(found.id);
        }

        // Create new webhook endpoint
        const endpoint = await stripe.webhookEndpoints.create({
            url: webhookUrl,
            enabled_events: ['checkout.session.completed'],
        });

        return Response.json({
            ok: true,
            webhookId: endpoint.id,
            webhookSecret: endpoint.secret,
            message: 'Webhook endpoint created. Set the secret as STRIPE_WEBHOOK_SECRET.',
        }, { headers: corsHeaders });
    } catch (err) {
        return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders });
    }
});
