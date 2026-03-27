import { useState, useEffect, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Copy, Clock, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type PaymentState = "idle" | "loading" | "awaiting" | "completed" | "expired" | "error";

interface PixPaymentFlowProps {
  amount: number; // in cents
  customer: {
    name: string;
    document: string;
    email: string;
    phone: string;
  };
  item: {
    title: string;
    price: number;
    quantity: number;
  };
  onCompleted?: (transactionId: string, paidAt: string) => void;
  onExpired?: () => void;
}

const POLL_INTERVAL = 5000;
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

export function PixPaymentFlow({ amount, customer, item, onCompleted, onExpired }: PixPaymentFlowProps) {
  const [state, setState] = useState<PaymentState>("idle");
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(SESSION_TIMEOUT / 1000);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const cleanup = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
    timerRef.current = null;
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const createCharge = async () => {
    setState("loading");
    setErrorMessage(null);

    try {
      const utm = window.location.search.replace(/^\?/, "");

      const { data, error } = await supabase.functions.invoke("create-pix-charge", {
        body: { amount, customer, item, utm },
      });

      if (error) throw new Error(error.message || "Erro ao criar cobrança");
      if (!data?.pixCode || !data?.transactionId) throw new Error("Resposta inválida do gateway");

      setPixCode(data.pixCode);
      setTransactionId(data.transactionId);
      setState("awaiting");

      startPolling(data.transactionId);
      startSessionTimer();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      setErrorMessage(message);
      setState("error");
    }
  };

  const startPolling = (txId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const projectUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const url = `${projectUrl}/functions/v1/check-pix-status?transactionId=${encodeURIComponent(txId)}`;
        const response = await fetch(url, {
          headers: { 'apikey': anonKey },
        });

        if (!response.ok) return; // next poll will retry

        const statusData = await response.json();

        if (statusData.status === "COMPLETED") {
          cleanup();
          setState("completed");
          onCompleted?.(txId, statusData.paidAt);
        }
      } catch {
        // Silently ignore, next poll will retry
      }
    }, POLL_INTERVAL);
  };

  const startSessionTimer = () => {
    const startTime = Date.now();

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, Math.ceil((SESSION_TIMEOUT - elapsed) / 1000));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        cleanup();
        setState("expired");
        onExpired?.();
      }
    }, 1000);

    timeoutRef.current = setTimeout(() => {
      cleanup();
      setState("expired");
      onExpired?.();
    }, SESSION_TIMEOUT);
  };

  const copyPixCode = async () => {
    if (!pixCode) return;
    try {
      await navigator.clipboard.writeText(pixCode);
      toast({ title: "Código PIX copiado!", description: "Cole no app do seu banco." });
    } catch {
      toast({ title: "Erro ao copiar", variant: "destructive" });
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  };

  if (state === "idle") {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Pagamento PIX</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary">{formatCurrency(amount)}</p>
            <p className="text-sm text-muted-foreground">{item.title}</p>
          </div>
          <Button onClick={createCharge} className="w-full" size="lg">
            Gerar QR Code PIX
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "loading") {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Gerando cobrança PIX...</p>
        </CardContent>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <p className="text-destructive font-medium">Erro ao gerar pagamento</p>
          <p className="text-sm text-muted-foreground text-center">{errorMessage}</p>
          <Button onClick={createCharge} variant="outline">
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "completed") {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-6">
          <div className="rounded-full bg-accent p-4">
            <CheckCircle className="h-12 w-12 text-primary" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">Pagamento confirmado!</h2>
            <p className="text-muted-foreground">Seu pagamento de {formatCurrency(amount)} foi recebido com sucesso.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state === "expired") {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <Clock className="h-12 w-12 text-muted-foreground" />
          <p className="font-medium">Tempo de pagamento expirado</p>
          <p className="text-sm text-muted-foreground text-center">O prazo de 15 minutos para realizar o pagamento expirou.</p>
          <Button onClick={() => { setState("idle"); setTimeLeft(SESSION_TIMEOUT / 1000); }}>
            Gerar novo QR Code
          </Button>
        </CardContent>
      </Card>
    );
  }

  // state === "awaiting"
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-center">Pague com PIX</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center">
          <p className="text-2xl font-bold text-primary">{formatCurrency(amount)}</p>
        </div>

        <div className="flex justify-center">
          <div className="bg-white p-4 rounded-lg border">
            {pixCode && <QRCodeSVG value={pixCode} size={220} level="M" />}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Expira em {formatTime(timeLeft)}</span>
        </div>

        <Button onClick={copyPixCode} variant="outline" className="w-full gap-2">
          <Copy className="h-4 w-4" />
          Copiar código PIX
        </Button>

        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Aguardando pagamento...</span>
        </div>
      </CardContent>
    </Card>
  );
}
