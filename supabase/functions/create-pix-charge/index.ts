import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const body = await req.json();
    const { amount, cpf, nome, telefone, quantidade, descricao, utm: bodyUtm } = body;

    // Convert amount from reais (decimal) to cents (integer)
    const amountInCents = Math.round((typeof amount === 'number' ? amount : parseFloat(amount)) * 100);

    if (!amountInCents || amountInCents < 100) {
      return new Response(JSON.stringify({ success: false, error: 'Valor mínimo é R$ 1,00' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Strip non-digits
    const cleanCpf = (cpf || '').replace(/\D/g, '');
    const cleanPhone = (telefone || '').replace(/\D/g, '');

    if (![11, 14].includes(cleanCpf.length)) {
      return new Response(JSON.stringify({ success: false, error: 'CPF/CNPJ inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (![10, 11].includes(cleanPhone.length)) {
      return new Response(JSON.stringify({ success: false, error: 'Telefone inválido (precisa ter DDD)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const itemTitle = descricao || 'Compra Viva Sorte';

    // Resolve UTM: prefer body utm, fallback to referer
    let utmString = bodyUtm || '';
    if (!utmString) {
      try {
        const referer = req.headers.get('referer') || '';
        const refUrl = new URL(referer);
        utmString = refUrl.search.replace(/^\?/, '');
      } catch { /* ignore */ }
    }

    const payload: Record<string, unknown> = {
      amount: amountInCents,
      customer: {
        name: nome || 'Cliente',
        document: cleanCpf,
        email: `${cleanCpf}@cliente.temp`,
        phone: cleanPhone,
      },
      item: {
        title: itemTitle,
        price: amountInCents,
        quantity: quantidade || 1,
      },
      paymentMethod: "PIX",
    };

    if (utmString) {
      payload.utm = utmString;
    }

    // Retry with exponential backoff on 5xx/network errors
    let lastError: Error | null = null;
    const delays = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(DUTTYFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.status >= 400 && response.status < 500) {
          const errorData = await response.text();
          console.error(`Duttyfy 4xx error [${response.status}]:`, errorData);
          return new Response(JSON.stringify({ success: false, error: `Erro no gateway: ${response.status}` }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (response.status >= 500) {
          lastError = new Error(`Gateway 5xx: ${response.status}`);
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, delays[attempt]));
            continue;
          }
          break;
        }

        const data = await response.json();
        console.log(`PIX charge created. URL suffix: ...${DUTTYFY_URL.slice(-8)}`);

        // Persist transaction immediately
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          
          await supabase.from('pix_transactions').upsert({
            transaction_id: data.transactionId,
            status: 'PENDING',
            amount: amountInCents,
            customer_name: nome,
            customer_email: payload.customer.email,
            customer_phone: cleanPhone,
            customer_document: cleanCpf,
            item_title: itemTitle,
            item_price: amountInCents,
            item_quantity: quantidade || 1,
            payment_method: 'PIX',
            pix_code: data.pixCode,
            utm: utmString || null,
          }, { onConflict: 'transaction_id' });
        } catch (dbErr) {
          console.error('DB persist error (non-blocking):', dbErr);
        }

        // Return in the format the existing HTML expects
        return new Response(JSON.stringify({
          success: true,
          codigo_pix: data.pixCode,
          qr_code: data.pixCode,
          transaction_id: data.transactionId,
          status: data.status,
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        lastError = err as Error;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, delays[attempt]));
          continue;
        }
      }
    }

    console.error('All retry attempts failed:', lastError?.message);
    return new Response(JSON.stringify({ success: false, error: 'Gateway indisponível após tentativas' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating PIX charge:', error);
    return new Response(JSON.stringify({ success: false, error: 'Erro interno do servidor' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
