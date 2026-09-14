/**
 * One parcel of credit, and not a byte more.
 *
 * This is what makes Kascade trustless PER PARCEL, not only at the final settlement. A fount serves
 * the next parcel only when the gatherer has already signed a voucher covering everything it has
 * received so far — so the fount is ever owed at most a single parcel, and a gatherer that stops
 * paying is cut off after one. The gatherer, for its part, signs only for parcels it has already
 * pulled and verified against the manifest. Neither side is ahead by more than one parcel at any
 * moment. This is metered's own rule ("the seller waits for the voucher"), applied to delivery, and
 * it uses metered's real voucher verification — a voucher that doesn't check, or that tries to lower
 * the ceiling, buys nothing.
 */
import { verifyVoucher, type Voucher, type ChannelRef } from 'metered-protocol';

export class VoucherRejected extends Error {}

export class Creditline {
  private delivered = 0; // sompi worth of parcels handed over
  private vouched = 0;   // sompi covered by the latest good voucher

  constructor(private readonly channel: ChannelRef, private readonly buyerPubkey: string) {}

  /** How much the fount is currently owed — parcels delivered but not yet vouched. */
  outstanding(): number {
    return this.delivered - this.vouched;
  }

  /** May the fount hand over one more parcel? Only if everything already delivered is paid for. */
  mayServe(): boolean {
    return this.outstanding() <= 0;
  }

  /** Record that a parcel worth `sompi` was handed over. */
  served(sompi: number): void {
    this.delivered += sompi;
  }

  /** Accept a voucher that raises the paid ceiling — refuse one that doesn't verify or that falls. */
  recordVoucher(voucher: Voucher): void {
    if (!verifyVoucher(voucher, this.channel, this.buyerPubkey)) {
      throw new VoucherRejected('the voucher does not verify for this gatherer and channel');
    }
    const amount = Number(voucher.amount);
    if (!Number.isSafeInteger(amount) || amount < this.vouched) {
      throw new VoucherRejected(`a voucher ceiling may not fall (${this.vouched} -> ${amount})`);
    }
    this.vouched = amount;
  }
}
