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

// Stripe fee pass-through: charge customer so seller receives full price.
// Standard Stripe rate: 2.9% + $0.30 per successful charge.
const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED_CENTS = 30;

function addStripeFee(amountCents: number): number {
    // charge = (amount + fixed) / (1 - percent)
    return Math.ceil((amountCents + STRIPE_FIXED_CENTS) / (1 - STRIPE_PERCENT));
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

        // Use subscription mode if any item has recurring billing, otherwise payment mode
        const hasSubscription = items.some((i: Record<string, unknown>) => i.subscriptionType === 'subscription');
        const checkoutMode = hasSubscription ? 'subscription' : 'payment';

        const periodToRecurring: Record<string, { interval: string; interval_count: number }> = {
            '1_month': { interval: 'month', interval_count: 1 },
            '3_months': { interval: 'month', interval_count: 3 },
            '6_months': { interval: 'month', interval_count: 6 },
            '1_year': { interval: 'year', interval_count: 1 },
        };

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
                const subPeriod = String(item.subscriptionPeriod || '1_month');

                if (!title || unitAmount <= 0) return null;

                const chargedAmount = addStripeFee(unitAmount);

                const priceData: Record<string, unknown> = {
                    currency: 'usd',
                    unit_amount: chargedAmount,
                    product_data: {
                        name: variantName ? `${title} (${variantName})` : title,
                        metadata: {
                            product_id: productId,
                            variant_name: variantName,
                        },
                    },
                };

                if (subType === 'subscription') {
                    const rec = periodToRecurring[subPeriod] || { interval: 'month', interval_count: 1 };
                    priceData.recurring = {
                        interval: rec.interval,
                        interval_count: rec.interval_count,
                    };
                }

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
