window.KEYZES_CONFIG = {
    // Public browser-safe values only
    supabaseUrl: 'https://gypznlmfkarzgzfbqhks.supabase.co',
    supabaseAnonKey: 'sb_publishable_dOTm7wbgndt8LFxgPiB06A_mER4lhNx',

    // Optional: redirect used in Supabase email verification links
    // Example: https://keyzes.com
    authRedirectUrl: 'https://keyzes.com',

    // Supabase Edge Function URL (optional, for confirmation emails)
    // Example: https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-order-email
    orderEmailFunctionUrl: 'YOUR_ORDER_EMAIL_FUNCTION_URL',

    // Supabase Edge Function URL (optional, Stripe hosted checkout)
    // Example: https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-stripe-checkout
    stripeCheckoutFunctionUrl: 'https://gypznlmfkarzgzfbqhks.supabase.co/functions/v1/create-stripe-checkout',

    // Optional: endpoint that deletes the authenticated customer account
    accountDeleteFunctionUrl: 'https://gypznlmfkarzgzfbqhks.supabase.co/functions/v1/delete-account'
};
