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

function sanitizePaymentMethodTypes(value: unknown) {
    const allowed = new Set([
        'acss_debit',
        'affirm',
        'afterpay_clearpay',
        'alipay',
        'alma',
        'amazon_pay',
        'au_becs_debit',
        'bacs_debit',
        'bancontact',
        'blik',
        'card',
        'cashapp',
        'eps',
        'giropay',
        'grabpay',
        'ideal',
        'klarna',
        'konbini',
        'link',
        'oxxo',
        'p24',
        'paypal',
        'promptpay',
        'revolut_pay',
        'sepa_debit',
        'sofort',
        'swish',
        'twint',
        'us_bank_account',
        'wechat_pay',
    ]);

    if (!Array.isArray(value)) return null;

    const cleaned = value
        .map((method) => String(method || '').trim().toLowerCase())
        .filter((method) => allowed.has(method));

    const unique = [...new Set(cleaned)];
    if (!unique.length) return null;
    if (!unique.includes('card')) unique.unshift('card');
    return unique;
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
        const paymentMethodTypes = sanitizePaymentMethodTypes(body.paymentMethodTypes);

        if (!customerEmail || !items.length || !successUrl || !cancelUrl) {
            return Response.json(
                { error: 'Missing customerEmail, items, successUrl, or cancelUrl' },
                { status: 400, headers: corsHeaders }
            );
        }

        // Always use payment mode — auto-renewal info is stored as order metadata
        const hasSubscription = items.some((i: Record<string, unknown>) => i.subscriptionType === 'subscription');
        const checkoutMode = 'payment';

        const stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2024-06-20',
        });

        const lineItems = items
            .map((item: Record<string, unknown>) => {
                const qty = Math.max(1, Number(item.qty || 1));
                const title = String(item.title || 'Product').trim();
                const variantName = String(item.variantName || '').trim();
                const productId = String(item.productId || '').trim();
                const unitAmount = moneyToCents(item.unitPrice);
                const subType = String(item.subscriptionType || 'onetime');
                const subPeriod = String(item.subscriptionPeriod || '');

                if (!title || unitAmount <= 0) return null;

                const priceData: Record<string, unknown> = {
                    currency: 'usd',
                    unit_amount: unitAmount,
                    product_data: {
                        name: variantName ? `${title} (${variantName})` : title,
                        metadata: {
                            product_id: productId,
                            variant_name: variantName,
                            subscription_type: subType,
                            subscription_period: subPeriod,
                        },
                    },
                };

                return {
                    quantity: qty,
                    price_data: priceData,
                };
            })
            .filter(Boolean);

        if (!lineItems.length) {
            return Response.json(
                { error: 'No valid line items found in payload' },
                { status: 400, headers: corsHeaders }
            );
        }

        const sessionPayload: Record<string, unknown> = {
            mode: checkoutMode,
            customer_email: customerEmail,
            line_items: lineItems,
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                source: 'keyzes-web',
                customer_name: customerName,
                affiliate_code: affiliateCode,
                discount_amount: String(discountAmount || 0),
                is_subscription: hasSubscription ? 'true' : 'false',
            },
        };

        // Only set explicit payment_method_types when the operator has configured
        // a custom list. Otherwise omit the param entirely — Stripe will present
        // every payment method enabled in the Dashboard (including Apple Pay,
        // Google Pay, Link, etc. based on the customer's device/country).
        if (paymentMethodTypes && paymentMethodTypes.length) {
            sessionPayload.payment_method_types = paymentMethodTypes;
        }

        const session = await stripe.checkout.sessions.create(sessionPayload as Parameters<typeof stripe.checkout.sessions.create>[0]);

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
