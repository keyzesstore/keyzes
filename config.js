window.KEYZES_CONFIG = {
    // Public browser-safe values only
    supabaseUrl: 'https://gypznlmfkarzgzfbqhks.supabase.co',
    supabaseAnonKey: 'sb_publishable_dOTm7wbgndt8LFxgPiB06A_mER4lhNx',

    // Optional: redirect used in Supabase email verification links
    // Example: https://keyzes.com
    authRedirectUrl: 'https://keyzes.com',

    // Supabase Edge Function URL (optional, for confirmation emails)
    // Example: https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-order-email
    orderEmailFunctionUrl: 'https://gypznlmfkarzgzfbqhks.supabase.co/functions/v1/send-order-email',

    // Supabase Edge Function URL (optional, Stripe hosted checkout)
    // Example: https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-stripe-checkout
    stripeCheckoutFunctionUrl: 'https://gypznlmfkarzgzfbqhks.supabase.co/functions/v1/create-stripe-checkout',

    // Optional: hosted checkout payment method types.
    // Leave unset to let Stripe decide automatically from Dashboard settings.
    // If you set a list manually, keep "card" for Apple Pay / Google Pay wallets.
    // Example: ['card', 'link', 'cashapp', 'klarna', 'paypal']
    // stripePaymentMethodTypes: ['card', 'link'],

    // Optional: endpoint that deletes the authenticated customer account
    accountDeleteFunctionUrl: 'https://gypznlmfkarzgzfbqhks.supabase.co/functions/v1/delete-account',

    // Optional: endpoint to cancel a subscription
    cancelSubscriptionFunctionUrl: 'https://gypznlmfkarzgzfbqhks.supabase.co/functions/v1/cancel-subscription'
};
