import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { addAttachment, addTransaction, cleanOrphanAttachments, deleteTransaction } from '../db/repo';
import { resetDb } from '../test/utils';
import { parseReceipt } from './receipt';

describe('reading receipts', () => {
  it('finds the total, date and shop on a supermarket receipt', () => {
    const text = `TESCO STORES 3297
High Street, London
Milk 1.15
Bread 1.40
SUBTOTAL 12.95
SAVINGS -0.45
TOTAL £12.50
VISA CONTACTLESS 12.50
14/10/2026 18:42
VAT 0.21`;
    expect(parseReceipt(text, '2026-10-14')).toEqual({ amount: 1250, date: '2026-10-14', merchant: 'Tesco' });
  });

  it('copes with comma decimals, written months and unknown shops', () => {
    const r = parseReceipt('Boulangerie du Coin\n12 Oct 2026\nMontant 7,80 EUR', '2026-10-14');
    expect(r).toEqual({ amount: 780, date: '2026-10-12', merchant: 'Boulangerie du Coin' });
  });

  it('ignores dates in the future or long ago, and falls back to the largest amount', () => {
    const r = parseReceipt('Corner Shop\n01/01/2030\n3.20\n4.75', '2026-10-14');
    expect(r).toEqual({ amount: 475, date: undefined, merchant: 'Corner Shop' });
  });
});

describe('attachments', () => {
  beforeEach(resetDb);

  it('are kept through an undo and cleaned up once the transaction is gone', async () => {
    const id = await addTransaction({ accountId: 'a', date: '2026-10-14', amount: -1250, payee: 'Tesco', categoryId: 'groceries' });
    await addAttachment({ transactionId: id, name: 'receipt.jpg', type: 'image/jpeg', size: 3, data: 'AAAA' });
    await expect(
      addAttachment({ transactionId: id, name: 'x.exe', type: 'application/x-msdownload', size: 3, data: 'AAAA' }),
    ).rejects.toThrow();
    const undo = await deleteTransaction(id);
    expect(await db.attachments.count()).toBe(1);
    await undo();
    expect(await cleanOrphanAttachments()).toBe(0);
    await deleteTransaction(id);
    expect(await cleanOrphanAttachments()).toBe(1);
    expect(await db.attachments.count()).toBe(0);
  });
});
