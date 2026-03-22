// @ts-nocheck
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
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
    }
    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
        return Response.json({ error: 'Missing server config' }, { status: 500, headers: corsHeaders });
    }

    let orderId: string;
    let customerEmail: string;
    try {
        const body = await req.json();
        orderId = String(body.orderId || '').trim();
        customerEmail = String(body.customerEmail || '').trim().toLowerCase();
    } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400, headers: corsHeaders });
    }

    if (!orderId || !customerEmail) {
        return Response.json({ error: 'orderId and customerEmail are required' }, { status: 400, headers: corsHeaders });
    }

    const db = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // Look up the order and verify ownership
    const { data: order, error: fetchErr } = await db
        .from('orders')
        .select('id, customer_email, stripe_subscription_id, subscription_status, is_subscription')
        .eq('id', orderId)
        .maybeSingle();

    if (fetchErr || !order) {
        return Response.json({ error: 'Order not found' }, { status: 404, headers: corsHeaders });
    }

    if (order.customer_email !== customerEmail) {
        return Response.json({ error: 'Unauthorized' }, { status: 403, headers: corsHeaders });
    }

    if (!order.is_subscription || !order.stripe_subscription_id) {
        return Response.json({ error: 'This order has no active subscription' }, { status: 400, headers: corsHeaders });
    }

    if (order.subscription_status === 'cancelled') {
        return Response.json({ error: 'Subscription is already cancelled' }, { status: 400, headers: corsHeaders });
    }

    // Cancel in Stripe
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    try {
        await stripe.subscriptions.cancel(order.stripe_subscription_id);
    } catch (err) {
        return Response.json({ error: 'Failed to cancel subscription in Stripe', detail: String(err) }, { status: 500, headers: corsHeaders });
    }

    // Update DB
    const { error: updateErr } = await db
        .from('orders')
        .update({ subscription_status: 'cancelled' })
        .eq('id', orderId);

    if (updateErr) {
        return Response.json({ error: 'Stripe cancelled but DB update failed', detail: updateErr.message }, { status: 500, headers: corsHeaders });
    }

    return Response.json({ ok: true, orderId }, { headers: corsHeaders });
});
