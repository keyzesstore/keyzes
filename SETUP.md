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
- `authRedirectUrl`: your production site URL (used in email verification links), e.g. `https://keyzes.com`
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

## 9) Enable Supabase Auth email verification

In Supabase dashboard:
1. Authentication -> Providers -> Email -> enable Email provider.
2. Keep "Confirm email" enabled.
3. Set Site URL to your production URL (for example `https://keyzes.com`).
4. Add additional redirect URLs if needed (preview URL, `https://www.keyzes.com`).

To send verification emails with Resend:
1. In Resend, generate an API key and verify your sending domain.
2. In Supabase dashboard -> Project Settings -> Auth -> SMTP settings.
3. Configure SMTP using Resend credentials:
   - Host: `smtp.resend.com`
   - Port: `465` (SSL) or `587` (TLS)
   - Username: `resend`
   - Password: your Resend API key
   - Sender email: a verified Resend sender (for example `noreply@mail.keyzes.com`)
4. Save and send a test auth email from Supabase.

## 10) Checkout behavior now

- Customer must sign up/login using Supabase Auth.
- Signup sends verification email; UI includes a "Resend verification email" action.
- Checkout uses the logged-in customer email automatically.
- Creates `orders` + `order_items` in Supabase.
- Calls `send-order-email` function.
- Clears cart after successful order creation.

## 11) Final verification checklist

1. Open deployed site.
2. Sign up with a new email.
3. Verify email from inbox (or use resend button and verify).
4. Log in and add product to cart.
5. Complete checkout.
6. Confirm a new row in `orders` table.
7. Confirm rows in `order_items`.
8. Confirm confirmation email is received.
