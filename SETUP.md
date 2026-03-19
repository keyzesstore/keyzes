# Keyzes Production Setup

## 1) Push this project to GitHub

1. Create a new GitHub repository.
2. Push your local project.

Example commands:

```bash
git init
git add .
git commit -m "Initial setup with Supabase + Resend scaffolding"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 2) Connect GitHub to Cloudflare Pages

1. In Cloudflare: Workers & Pages -> Create application -> Pages -> Connect to Git.
2. Select your repo.
3. Build settings for this static project:
   - Framework preset: None
   - Build command: (leave empty)
   - Build output directory: /
4. Deploy.

## 3) Connect your custom domain

1. In Cloudflare Pages project -> Custom domains -> Add `keyzes.com`.
2. Cloudflare will set records automatically if DNS is on Cloudflare.
3. Enable SSL/TLS Full (strict).

## 4) Set up Supabase database

Run migration SQL from:
- `supabase/migrations/20260319_init_orders.sql`

In Supabase dashboard:
1. SQL Editor -> New query.
2. Paste the migration SQL.
3. Run it.

## 5) Deploy the email function (Supabase Edge Function)

Prerequisites:
- Supabase CLI installed.
- Logged in with `supabase login`.
- Linked project with `supabase link --project-ref YOUR_PROJECT_REF`.

Deploy:

```bash
supabase functions deploy send-order-email
```

Set function secrets:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxx
supabase secrets set FROM_EMAIL=orders@keyzes.com
supabase secrets set STORE_NAME=Keyzes
```

## 6) Set up Resend domain

Recommended: use a subdomain like `mail.keyzes.com` for sending.

In Resend:
1. Add domain `mail.keyzes.com` (or root if preferred).
2. Add the exact DNS records Resend gives you in Cloudflare DNS.
3. Wait for verification.
4. Use `FROM_EMAIL` with verified domain, e.g. `orders@mail.keyzes.com`.

## 7) Configure browser app

Edit `config.js` and set:

- `supabaseUrl`: from Supabase project settings
- `supabaseAnonKey`: from Supabase API settings
- `orderEmailFunctionUrl`: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-order-email`

Important:
- Never put service role key in frontend.
- Only anon key is allowed in frontend.

## 8) Enable function invocation from browser

In Supabase dashboard, allow your site origin in function CORS if needed.
Suggested origins:
- `https://keyzes.com`
- `https://www.keyzes.com`
- Cloudflare Pages preview URL

## 9) Checkout behavior now

- Checkout asks for customer email.
- Creates `orders` + `order_items` in Supabase.
- Calls `send-order-email` function.
- Clears cart after successful order creation.

## 10) Final verification checklist

1. Open deployed site.
2. Add product to cart.
3. Checkout with email.
4. Confirm a new row in `orders` table.
5. Confirm rows in `order_items`.
6. Confirm confirmation email is received.
