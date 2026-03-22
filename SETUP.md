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
supabase functions deploy delete-account
supabase functions deploy create-stripe-checkout
```

Set function secrets:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxx
supabase secrets set FROM_EMAIL=orders@keyzes.com
supabase secrets set STORE_NAME=Keyzes
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxxxx
```

Notes for `delete-account`:
- This function uses `SUPABASE_SERVICE_ROLE_KEY` to delete the authenticated user.
- Keep service role key in Supabase secrets only (never in frontend files).
- The frontend calls it using the logged-in user's bearer token.

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
- `stripeCheckoutFunctionUrl`: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-stripe-checkout`
- `accountDeleteFunctionUrl` (optional): `https://YOUR_PROJECT_REF.supabase.co/functions/v1/delete-account`

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

To make verification emails look better:
1. Go to Authentication -> Email Templates -> Confirm signup.
2. Keep `{{ .ConfirmationURL }}` exactly as-is for the button link.
3. Paste this HTML template:

```html
<!doctype html>
<html>
   <body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 12px;">
         <tr>
            <td align="center">
               <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
                  <tr>
                     <td style="background:linear-gradient(135deg,#0f766e,#0ea5e9);padding:24px 28px;color:#ffffff;">
                        <h1 style="margin:0;font-size:24px;line-height:1.2;">Welcome to Keyzes</h1>
                        <p style="margin:10px 0 0;font-size:14px;line-height:1.5;opacity:.95;">Confirm your email to activate your account.</p>
                     </td>
                  </tr>
                  <tr>
                     <td style="padding:24px 28px;">
                        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Thanks for joining Keyzes. Click the button below to verify your email and start shopping.</p>
                        <p style="margin:0 0 20px;">
                           <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px;font-size:14px;">Confirm Email</a>
                        </p>
                        <p style="margin:0;font-size:13px;line-height:1.6;color:#4b5563;">If the button does not work, copy and paste this link into your browser:</p>
                        <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#6b7280;word-break:break-all;">{{ .ConfirmationURL }}</p>
                     </td>
                  </tr>
                  <tr>
                     <td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
                        <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">If you did not create this account, you can safely ignore this email.</p>
                     </td>
                  </tr>
               </table>
            </td>
         </tr>
      </table>
   </body>
</html>
```

## 10) Checkout behavior now

- Customer must sign up/login using Supabase Auth.
- Signup sends verification email; UI includes a "Resend verification email" action.
- Checkout uses the logged-in customer email automatically.
- If `stripeCheckoutFunctionUrl` is configured, checkout redirects to Stripe hosted checkout.
- If Stripe checkout is not configured, checkout falls back to direct `orders` + `order_items` creation in Supabase.
- Calls `send-order-email` function in the non-Stripe fallback flow.

## 10.1) Admin + account behavior

- The account `keyzes.store@gmail.com` is treated as the admin account in the storefront UI.
- Admin panel buttons are hidden for all other users.
- Regular users get an Account settings page with:
   - change password,
   - forgot-password email reset,
   - delete account button (requires `accountDeleteFunctionUrl` function).

Suggested delete-account function behavior:
- Read authenticated user from Supabase JWT.
- Delete that user with service role privileges.
- Return `200` only when deletion succeeds.

## 11) Final verification checklist

1. Open deployed site.
2. Sign up with a new email.
3. Verify email from inbox (or use resend button and verify).
4. Log in and add product to cart.
5. Complete checkout.
6. Confirm a new row in `orders` table.
7. Confirm rows in `order_items`.
8. Confirm confirmation email is received.
9. Confirm verification link opens your production site (not localhost).
