// @ts-nocheck
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

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
        return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey || !anonKey) {
        return Response.json({ error: 'Server configuration error' }, { status: 500, headers: corsHeaders });
    }

    // Verify user identity via JWT
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
        return Response.json({ error: 'Missing bearer token' }, { status: 401, headers: corsHeaders });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const userEmail = (user.email || '').trim().toLowerCase();
    if (!userEmail) {
        return Response.json({ error: 'No email on account' }, { status: 400, headers: corsHeaders });
    }

    try {
        const body = await req.json();
        const orderId = String(body.orderId || '').trim();

        if (!orderId) {
            return Response.json({ error: 'Missing orderId' }, { status: 400, headers: corsHeaders });
        }

        // Fetch order from DB — must belong to this user
        const db = createClient(supabaseUrl, supabaseServiceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: order, error: orderErr } = await db
            .from('orders')
            .select('id, customer_email, is_subscription, stripe_subscription_id')
            .eq('id', orderId)
            .single();

        if (orderErr || !order) {
            return Response.json({ error: 'Order not found' }, { status: 404, headers: corsHeaders });
        }

        if (order.customer_email.toLowerCase() !== userEmail) {
            return Response.json({ error: 'Not your order' }, { status: 403, headers: corsHeaders });
        }

        if (!order.is_subscription || !order.stripe_subscription_id) {
            return Response.json({ error: 'This order is not an active subscription' }, { status: 400, headers: corsHeaders });
        }

        // Cancel the Stripe subscription
        const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
        const subscription = await stripe.subscriptions.cancel(order.stripe_subscription_id);

        // Update order in DB
        await db
            .from('orders')
            .update({
                is_subscription: false,
                delivery_status: 'delivered',
                delivery_description: 'Subscription cancelled by customer',
                updated_at: new Date().toISOString(),
            })
            .eq('id', orderId);

        return Response.json(
            { ok: true, status: subscription.status },
            { status: 200, headers: corsHeaders }
        );
    } catch (err) {
        return Response.json(
            { error: String(err) },
            { status: 500, headers: corsHeaders }
        );
    }
});
