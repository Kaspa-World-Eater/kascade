/**
 * One parcel of credit, publisher-pays edition — the receipt mirror of [[creditline]].
 *
 * In viewer-pays a fount serves the next parcel only once the buyer has signed a money voucher for
 * what it already got. In publisher-pays the viewer pays nothing, so it signs a RECEIPT instead — its
 * proof the parcel verified, which the fount later claims against the publisher. The bound is the
 * same: a fount is ever owed at most one un-receipted parcel, so a viewer that takes bytes and stops
 * signing is cut off after one. This is what stops a free-serving fount from being drained by a viewer
 * that never acknowledges delivery.
 */
import { verifyReceipt, type Receipt } from './receipt.js';

export class ReceiptRejected extends Error {}

export class ReceiptLine {
  private readonly delivered = new Set<number>();
  private readonly receipted = new Set<number>();

  constructor(private readonly viewerPubkey: string, private readonly fileId: string, private readonly fountUrl: string) {}

  /** Parcels handed over but not yet acknowledged by a receipt. */
  outstanding(): number {
    return this.delivered.size - this.receipted.size;
  }

  /** May the fount hand over one more? Only if everything delivered so far has a receipt. */
  mayServe(): boolean {
    return this.outstanding() <= 0;
  }

  /** Record that parcel `index` was handed over. */
  served(index: number): void {
    this.delivered.add(index);
  }

  /** Accept a receipt for a parcel this fount actually delivered, signed by this viewer. */
  recordReceipt(r: Receipt): void {
    if (r.fileId !== this.fileId || r.fountUrl !== this.fountUrl) {
      throw new ReceiptRejected('receipt is not for this file and fount');
    }
    if (!verifyReceipt(r, this.viewerPubkey)) {
      throw new ReceiptRejected('receipt does not verify for this viewer');
    }
    if (!this.delivered.has(r.index)) {
      throw new ReceiptRejected(`receipt for parcel ${r.index}, which was not delivered here`);
    }
    this.receipted.add(r.index);
  }
}
