// @ts-nocheck
import { Resend } from 'npm:resend@2.0.0';

const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
const fromEmail = Deno.env.get('FROM_EMAIL') || 'orders@keyzes.com';
const storeName = Deno.env.get('STORE_NAME') || 'Keyzes';

Deno.serve(async (req) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    if (!resendApiKey) {
        return Response.json({ error: 'Missing RESEND_API_KEY' }, { status: 500, headers: corsHeaders });
    }

    try {
        const body = await req.json();
        const customerEmail = String(body.customerEmail || '').trim();
        const orderId = String(body.orderId || '').trim();
        const emailType = String(body.type || 'confirmation').trim();

        if (!customerEmail || !orderId) {
            return Response.json({ error: 'Missing customerEmail or orderId' }, { status: 400, headers: corsHeaders });
        }

        const resend = new Resend(resendApiKey);

        if (emailType === 'status_update') {
            // Status update email (delivering / delivered / etc.)
            const status = String(body.status || 'processing').trim();
            const statusLabel = String(body.statusLabel || status).trim();
            const description = String(body.description || '').trim();

            const statusEmoji: Record<string, string> = {
                processing: '⏳',
                delivering: '🚚',
                delivered: '✅',
            };

            const emoji = statusEmoji[status] || '📦';

            let descriptionHtml = '';
            if (description) {
                descriptionHtml = `
                    <h3>Message from ${storeName}</h3>
                    <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin:12px 0;white-space:pre-wrap;">${description.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                `;
            }

            const { error } = await resend.emails.send({
                from: fromEmail,
                to: customerEmail,
                subject: `${emoji} ${storeName} - Order ${statusLabel} (${orderId.substring(0, 8)})`,
                html: `
                    <h2>${emoji} Your order is ${statusLabel.toLowerCase()}</h2>
                    <p>Order <strong>${orderId}</strong></p>
                    <p>Status: <strong>${statusLabel}</strong></p>
                    ${descriptionHtml}
                    <p style="margin-top:24px;color:#666;">Thank you for shopping with ${storeName}!</p>
                `,
            });

            if (error) {
                return Response.json({ error }, { status: 500, headers: corsHeaders });
            }
            return Response.json({ ok: true }, { headers: corsHeaders });
        }

        // Default: order confirmation email
        const subtotal = Number(body.subtotal || 0);
        const items = Array.isArray(body.items) ? body.items : [];

        const itemsHtml = items
            .map((item: Record<string, unknown>) => {
                const title = String(item.product_title || 'Item');
                const variant = item.variant_name ? ` (${String(item.variant_name)})` : '';
                const qty = Number(item.qty || 1);
                const lineTotal = Number(item.line_total || 0).toFixed(2);
                return `<li>${title}${variant} x ${qty} - $${lineTotal}</li>`;
            })
            .join('');

        const { error } = await resend.emails.send({
            from: fromEmail,
            to: customerEmail,
            subject: `${storeName} order confirmation (${orderId})`,
            html: `
                <h2>Thanks for your order!</h2>
                <p>Your order <strong>${orderId}</strong> was received.</p>
                <p><strong>Subtotal:</strong> $${subtotal.toFixed(2)}</p>
                <h3>Items</h3>
                <ul>${itemsHtml}</ul>
                <p style="margin-top:24px;color:#666;">We'll send you another email when your order ships!</p>
            `,
        });

        if (error) {
            return Response.json({ error }, { status: 500, headers: corsHeaders });
        }

        return Response.json({ ok: true }, { headers: corsHeaders });
    } catch (err) {
        return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders });
    }
});
