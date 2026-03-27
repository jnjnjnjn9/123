import { PixPaymentFlow } from "@/components/PixPaymentFlow";

const Index = () => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <PixPaymentFlow
        amount={4990}
        customer={{
          name: "Cliente Teste",
          document: "12345678901",
          email: "teste@email.com",
          phone: "11987654321",
        }}
        item={{
          title: "Plano Mensal",
          price: 4990,
          quantity: 1,
        }}
        onCompleted={(txId, paidAt) => {
          console.log("Payment completed!", txId, paidAt);
        }}
        onExpired={() => {
          console.log("Payment expired");
        }}
      />
    </div>
  );
};

export default Index;
