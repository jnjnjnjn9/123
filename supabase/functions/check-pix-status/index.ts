import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const DUTTYFY_URL = Deno.env.get('DUTTYFY_PIX_URL_ENCRYPTED');
    if (!DUTTYFY_URL) {
      throw new Error('DUTTYFY_PIX_URL_ENCRYPTED is not configured');
    }

    // Accept both GET with query param and POST with body
    let transactionId: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      transactionId = url.searchParams.get('transactionId') || url.searchParams.get('transaction_id');
    } else {
      const body = await req.json();
      transactionId = body.transaction_id || body.transactionId;
    }

    if (!transactionId) {
      return new Response(JSON.stringify({ success: false, error: 'transaction_id é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const statusUrl = `${DUTTYFY_URL}?transactionId=${encodeURIComponent(transactionId)}`;
    const response = await fetch(statusUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Status check failed [${response.status}]:`, errorText);
      return new Response(JSON.stringify({ success: false, error: `Erro no gateway: ${response.status}` }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();

    // Map Duttyfy status to the format the HTML expects
    const statusMap: Record<string, string> = {
      'COMPLETED': 'paid',
      'PENDING': 'pending',
    };

    return new Response(JSON.stringify({
      success: true,
      status: statusMap[data.status] || data.status.toLowerCase(),
      allowpay_status: data.status,
      ...(data.paidAt ? { paid_at: data.paidAt } : {}),
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error checking PIX status:', error);
    return new Response(JSON.stringify({ success: false, error: 'Erro interno do servidor' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
