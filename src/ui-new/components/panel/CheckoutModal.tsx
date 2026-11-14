import { Component, Show } from 'solid-js';
import { pendingCheckout, finishCheckout, formatPrice } from '../../../infrastructure/payments/checkout';

// TEST MODE payment screen. Swap for Stripe Checkout later.
export const CheckoutModal: Component = () => {
  return (
    <Show when={pendingCheckout()}>
      {(req) => (
        <div class="modal-backdrop" onClick={() => finishCheckout(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <div class="test-badge">TEST MODE · no real charge</div>
            <div class="modal-title">{req().label}</div>
            <div class="modal-price">{formatPrice(req().amountCents)}</div>
            <div class="modal-actions">
              <button class="btn btn-secondary" onClick={() => finishCheckout(false)}>Cancel</button>
              <button class="btn btn-primary" onClick={() => finishCheckout(true)}>Pay (test)</button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};
