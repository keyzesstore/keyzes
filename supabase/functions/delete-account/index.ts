// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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

    if (!supabaseUrl || !serviceRoleKey) {
        return Response.json(
            { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' },
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

    const jwt = authHeader.replace('Bearer ', '').trim();
    if (!jwt) {
        return Response.json(
            { error: 'Invalid bearer token' },
            { status: 401, headers: corsHeaders }
        );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    const {
        data: { user },
        error: userError,
    } = await admin.auth.getUser(jwt);

    if (userError || !user) {
        return Response.json(
            { error: 'Unauthorized user token' },
            { status: 401, headers: corsHeaders }
        );
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
        return Response.json(
            { error: deleteError.message || 'Failed to delete account' },
            { status: 500, headers: corsHeaders }
        );
    }

    return Response.json({ ok: true }, { status: 200, headers: corsHeaders });
});
