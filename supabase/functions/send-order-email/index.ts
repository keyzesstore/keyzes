// @ts-nocheck
import { Resend } from 'npm:resend@2.0.0';

const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
const fromEmail = Deno.env.get('FROM_EMAIL') || 'orders@keyzes.com';
const storeName = Deno.env.get('STORE_NAME') || 'Keyzes';

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    if (!resendApiKey) {
        return Response.json({ error: 'Missing RESEND_API_KEY' }, { status: 500 });
    }

    try {
        const body = await req.json();
        const customerEmail = body.customerEmail as string;
        const orderId = body.orderId as string;
        const subtotal = Number(body.subtotal || 0);
        const items = Array.isArray(body.items) ? body.items : [];

        if (!customerEmail || !orderId) {
            return Response.json({ error: 'Missing customerEmail or orderId' }, { status: 400 });
        }

        const itemsHtml = items
            .map((item: Record<string, unknown>) => {
                const title = String(item.product_title || 'Item');
                const variant = item.variant_name ? ` (${String(item.variant_name)})` : '';
                const qty = Number(item.qty || 1);
                const lineTotal = Number(item.line_total || 0).toFixed(2);
                return `<li>${title}${variant} x ${qty} - $${lineTotal}</li>`;
            })
            .join('');

        const resend = new Resend(resendApiKey);
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
            `,
        });

        if (error) {
            return Response.json({ error }, { status: 500 });
        }

        return Response.json({ ok: true });
    } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
    }
});
