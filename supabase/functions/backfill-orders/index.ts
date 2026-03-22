// Temporary: fetch recent completed checkout sessions and insert missing orders
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
        return Response.json({ error: 'Missing env vars' }, { status: 500, headers: corsHeaders });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const db = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // Fetch recent completed sessions
    const sessions = await stripe.checkout.sessions.list({
        status: 'complete',
        limit: 20,
        expand: ['data.line_items'],
    });

    const results: any[] = [];

    for (const session of sessions.data) {
        const stripeSessionId = String(session.id);
        const orderSource = `stripe:${stripeSessionId}`;

        // Check if already inserted
        const { data: existing } = await db
            .from('orders')
            .select('id')
            .eq('source', orderSource)
            .maybeSingle();

        if (existing) {
            results.push({ session: stripeSessionId, status: 'already_exists', orderId: existing.id });
            continue;
        }

        const customerEmail = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
        const isSubscription = session.mode === 'subscription' || session.metadata?.is_subscription === 'true';
        const subscriptionPeriod = String(session.metadata?.subscription_period || '').trim();
        const stripeSubscriptionId = session.subscription ? String(session.subscription) : null;
        const subtotal = Number(session.amount_total || 0) / 100;

        // Get line items
        let lineItems = session.line_items?.data || [];
        if (!lineItems.length) {
            const li = await stripe.checkout.sessions.listLineItems(stripeSessionId, { limit: 100 });
            lineItems = li.data || [];
        }

        const { data: orderRow, error: orderError } = await db
            .from('orders')
            .insert({
                customer_email: customerEmail,
                status: 'paid',
                delivery_status: 'processing',
                subtotal,
                currency: String((session.currency || 'usd')).toUpperCase(),
                source: orderSource,
                is_subscription: isSubscription,
                subscription_period: subscriptionPeriod || null,
                stripe_subscription_id: stripeSubscriptionId,
                subscription_status: isSubscription ? 'active' : 'none',
            })
            .select('id')
            .single();

        if (orderError || !orderRow?.id) {
            results.push({ session: stripeSessionId, status: 'insert_failed', error: orderError?.message });
            continue;
        }

        const itemsPayload = lineItems.map((li: any) => {
            const description = String(li.description || 'Item');
            const qty = Number(li.quantity || 1);
            const unitPrice = Number(li.amount_subtotal || 0) / 100 / Math.max(qty, 1);
            const lineTotal = Number(li.amount_total || 0) / 100;
            const productMeta = li.price?.product_details?.metadata || {};
            return {
                order_id: orderRow.id,
                product_id: String(productMeta.product_id || description).trim(),
                product_title: description,
                variant_name: String(productMeta.variant_name || '').trim() || null,
                unit_price: unitPrice,
                qty,
                line_total: lineTotal,
            };
        });

        if (itemsPayload.length) {
            await db.from('order_items').insert(itemsPayload);
        }

        results.push({ session: stripeSessionId, status: 'inserted', orderId: orderRow.id, email: customerEmail, total: subtotal });
    }

    return Response.json({ ok: true, results }, { headers: corsHeaders });
});
