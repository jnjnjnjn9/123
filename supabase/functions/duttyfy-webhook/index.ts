import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    console.log('📩 Webhook received:', JSON.stringify(payload).slice(0, 500));

    // Extract transactionId — may come as transactionId or _id.$oid
    const transactionId = payload.transactionId || payload._id?.$oid;
    if (!transactionId) {
      console.error('❌ Webhook missing transactionId and _id.$oid');
      return new Response('OK', { status: 200 });
    }

    const status = payload.status; // PENDING or COMPLETED

    if (status === 'PENDING') {
      // Upsert on PENDING (charge creation webhook)
      const { error } = await supabase
        .from('pix_transactions')
        .upsert({
          transaction_id: transactionId,
          status: 'PENDING',
          amount: payload.amount,
          customer_name: payload.customer?.name,
          customer_email: payload.customer?.email,
          customer_phone: payload.customer?.phone,
          customer_document: payload.customer?.document,
          item_title: payload.items?.title,
          item_price: payload.items?.price,
          item_quantity: payload.items?.quantity,
          payment_method: payload.paymentMethod || 'PIX',
          utm: payload.utm,
          webhook_raw: payload,
        }, { onConflict: 'transaction_id' });

      if (error) {
        console.error('❌ DB upsert error (PENDING):', error);
      } else {
        console.log(`✅ Transaction ${transactionId} saved as PENDING`);
      }
    } else if (status === 'COMPLETED') {
      // Conditional UPDATE — never INSERT OR REPLACE
      // First check if already completed (idempotency)
      const { data: existing } = await supabase
        .from('pix_transactions')
        .select('status')
        .eq('transaction_id', transactionId)
        .single();

      if (existing?.status === 'COMPLETED') {
        console.log(`⏭️ Transaction ${transactionId} already COMPLETED, skipping`);
        return new Response('OK', { status: 200 });
      }

      const { error } = await supabase
        .from('pix_transactions')
        .update({
          status: 'COMPLETED',
          paid_at: new Date().toISOString(),
          webhook_raw: payload,
        })
        .eq('transaction_id', transactionId);

      if (error) {
        console.error('❌ DB update error (COMPLETED):', error);
      } else {
        console.log(`✅ Transaction ${transactionId} marked as COMPLETED`);
      }
    } else {
      console.log(`ℹ️ Unknown status "${status}" for ${transactionId}`);
    }

    // Respond 2xx fast
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    // Still return 200 to avoid Duttyfy retries on processing errors
    return new Response('OK', { status: 200 });
  }
});
