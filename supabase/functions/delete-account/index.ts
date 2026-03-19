// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
        return Response.json(
            { error: 'Server configuration error' },
            { status: 500, headers: corsHeaders }
        );
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
        return Response.json(
            { error: 'Missing bearer token' },
            { status: 401, headers: corsHeaders }
        );
    }

    // Verify the JWT using a user-scoped client — the correct Supabase Edge Function pattern.
    // admin.auth.getUser(jwt) does not work reliably; creating a client with the JWT
    // in the global Authorization header and calling getUser() without args is correct.
    const userClient = createClient(supabaseUrl, anonKey, {
        global: {
            headers: { Authorization: authHeader },
        },
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
        return Response.json(
            { error: 'Unauthorized user token' },
            { status: 401, headers: corsHeaders }
        );
    }

    // Use admin client only for the privileged deleteUser operation
    const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
        return Response.json(
            { error: deleteError.message || 'Failed to delete account' },
            { status: 500, headers: corsHeaders }
        );
    }

    return Response.json({ ok: true }, { status: 200, headers: corsHeaders });
});
