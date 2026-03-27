-- Create table to store PIX transactions
CREATE TABLE public.pix_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  amount INTEGER NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  customer_document TEXT,
  item_title TEXT,
  item_price INTEGER,
  item_quantity INTEGER,
  payment_method TEXT DEFAULT 'PIX',
  utm TEXT,
  pix_code TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  webhook_raw JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pix_transactions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
-- No public policies - this table is only accessed by edge functions
CREATE POLICY "Service role full access" ON public.pix_transactions
  FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_pix_transactions_status ON public.pix_transactions (status);
CREATE INDEX idx_pix_transactions_transaction_id ON public.pix_transactions (transaction_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_pix_transactions_updated_at
  BEFORE UPDATE ON public.pix_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();