import { createSignal } from 'solid-js';

// TEST MODE checkout. No real money moves.
// To take real payments later, replace startCheckout() with a call to your
// server that creates a Stripe Checkout session, and only save the post
// after Stripe confirms the payment.

export interface CheckoutRequest {
  label: string;
  amountCents: number;
  resolve: (paymentId: string | null) => void;
}

const [pendingCheckout, setPendingCheckout] = createSignal<CheckoutRequest | null>(null);

export { pendingCheckout };

export function startCheckout(label: string, amountCents: number): Promise<string | null> {
  return new Promise((resolve) => {
    setPendingCheckout({ label, amountCents, resolve });
  });
}

export function finishCheckout(paid: boolean) {
  const req = pendingCheckout();
  if (!req) return;
  setPendingCheckout(null);
  req.resolve(paid ? `test_${crypto.randomUUID()}` : null);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
