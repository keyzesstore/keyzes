// @ts-nocheck
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@2.0.0';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
const fromEmail = Deno.env.get('FROM_EMAIL') || 'orders@keyzes.com';
const storeName = Deno.env.get('STORE_NAME') || 'Keyzes';

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
        return Response.json({ error: 'Missing required environment variables' }, { status: 500 });
    }

    const signature = req.headers.get('stripe-signature') || '';
    if (!signature) {
        return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    const rawBody = await req.text();
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    let event;
    try {
        event = await stripe.webhooks.constructEventAsync(rawBody, signature, stripeWebhookSecret);
    } catch (err) {
        return Response.json({ error: 'Webhook signature verification failed', detail: String(err) }, { status: 400 });
    }

    if (event.type !== 'checkout.session.completed') {
        return Response.json({ ok: true, ignored: true, type: event.type }, { status: 200 });
    }

    const session = event.data.object;
    const stripeSessionId = String(session.id || '').trim();
    const customerEmail = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
    const isSubscription = session.mode === 'subscription' || session.metadata?.is_subscription === 'true';
    const subscriptionPeriod = String(session.metadata?.subscription_period || '').trim();
    const stripeSubscriptionId = session.subscription ? String(session.subscription) : null;

    if (!stripeSessionId || !customerEmail) {
        return Response.json({ error: 'Missing stripe session id or customer email' }, { status: 400 });
    }

    const db = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    // Idempotency: skip if this session was already inserted.
    const orderSource = `stripe:${stripeSessionId}`;
    const { data: existing } = await db
        .from('orders')
        .select('id')
        .eq('source', orderSource)
        .limit(1)
        .maybeSingle();

    if (existing && existing.id) {
        return Response.json({ ok: true, duplicate: true, orderId: existing.id }, { status: 200 });
    }

    const lineItemsResponse = await stripe.checkout.sessions.listLineItems(stripeSessionId, { limit: 100 });
    const lineItems = lineItemsResponse.data || [];

    const subtotal = Number(session.amount_total || 0) / 100;

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
        })
        .select('id')
        .single();

    if (orderError || !orderRow?.id) {
        return Response.json({ error: 'Failed to insert order', detail: orderError?.message || '' }, { status: 500 });
    }

    const itemsPayload = lineItems.map((lineItem) => {
        const description = String(lineItem.description || 'Item');
        const qty = Number(lineItem.quantity || 1);
        const unitPrice = Number(lineItem.amount_subtotal || 0) / 100 / Math.max(qty, 1);
        const lineTotal = Number(lineItem.amount_total || 0) / 100;

        const productMeta = lineItem.price?.product_details?.metadata || {};
        const productId = String(productMeta.product_id || description).trim();
        const variantName = String(productMeta.variant_name || '').trim() || null;

        return {
            order_id: orderRow.id,
            product_id: productId,
            product_title: description,
            variant_name: variantName,
            unit_price: unitPrice,
            qty,
            line_total: lineTotal,
        };
    });

    if (itemsPayload.length) {
        const { error: itemsError } = await db.from('order_items').insert(itemsPayload);
        if (itemsError) {
            return Response.json({ error: 'Order saved but failed to insert items', detail: itemsError.message }, { status: 500 });
        }
    }

    if (resendApiKey) {
        try {
            const resend = new Resend(resendApiKey);
            const itemsHtml = itemsPayload
                .map((item) => {
                    const variant = item.variant_name ? ` (${item.variant_name})` : '';
                    return `<li>${item.product_title}${variant} x ${item.qty} - $${Number(item.line_total || 0).toFixed(2)}</li>`;
                })
                .join('');

            await resend.emails.send({
                from: fromEmail,
                to: customerEmail,
                subject: `${storeName} order confirmation (${orderRow.id})`,
                html: `
                    <h2>Thanks for your order!</h2>
                    <p>Your order <strong>${orderRow.id}</strong> has been paid successfully.</p>
                    <p><strong>Total:</strong> $${subtotal.toFixed(2)}</p>
                    <h3>Items</h3>
                    <ul>${itemsHtml}</ul>
                `,
            });
        } catch {
            // Keep webhook success even if email fails.
        }
    }

    return Response.json({ ok: true, orderId: orderRow.id }, { status: 200 });
});
