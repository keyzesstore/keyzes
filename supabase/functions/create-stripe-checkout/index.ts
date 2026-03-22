// @ts-nocheck
import Stripe from 'npm:stripe@17.7.0';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function moneyToCents(value: unknown) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.round(num * 100);
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return new Response('Method not allowed', {
            status: 405,
            headers: corsHeaders,
        });
    }

    if (!stripeSecretKey) {
        return Response.json(
            { error: 'Missing STRIPE_SECRET_KEY' },
            { status: 500, headers: corsHeaders }
        );
    }

    try {
        const body = await req.json();
        const customerEmail = String(body.customerEmail || '').trim();
        const customerName = String(body.customerName || '').trim();
        const items = Array.isArray(body.items) ? body.items : [];
        const successUrl = String(body.successUrl || '').trim();
        const cancelUrl = String(body.cancelUrl || '').trim();
        const discountAmount = Number(body.discountAmount || 0);
        const affiliateCode = String(body.affiliateCode || '').trim();

        if (!customerEmail || !items.length || !successUrl || !cancelUrl) {
            return Response.json(
                { error: 'Missing customerEmail, items, successUrl, or cancelUrl' },
                { status: 400, headers: corsHeaders }
            );
        }

        const stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2024-06-20',
        });

        const lineItems = items
            .map((item: Record<string, unknown>) => {
                const qty = Math.max(1, Number(item.qty || 1));
                const title = String(item.title || 'Product').trim();
                const variantName = String(item.variantName || '').trim();
                const unitAmount = moneyToCents(item.unitPrice);

                if (!title || unitAmount <= 0) return null;

                return {
                    quantity: qty,
                    price_data: {
                        currency: 'usd',
                        unit_amount: unitAmount,
                        product_data: {
                            name: variantName ? `${title} (${variantName})` : title,
                        },
                    },
                };
            })
            .filter(Boolean);

        if (!lineItems.length) {
            return Response.json(
                { error: 'No valid line items found in payload' },
                { status: 400, headers: corsHeaders }
            );
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            customer_email: customerEmail,
            line_items: lineItems,
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                source: 'keyzes-web',
                customer_name: customerName,
                affiliate_code: affiliateCode,
                discount_amount: String(discountAmount || 0),
            },
        });

        if (!session.url) {
            return Response.json(
                { error: 'Stripe did not return a checkout URL' },
                { status: 500, headers: corsHeaders }
            );
        }

        return Response.json(
            { ok: true, id: session.id, url: session.url },
            { status: 200, headers: corsHeaders }
        );
    } catch (err) {
        return Response.json(
            { error: String(err) },
            { status: 500, headers: corsHeaders }
        );
    }
});
