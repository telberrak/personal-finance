import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { db } from '../db/db';
import { seedDemoData } from '../db/seed';
import { resetDb } from '../test/utils';

beforeEach(async () => {
  await resetDb();
  await seedDemoData();
  window.history.pushState({}, '', '/add');
});

describe('Transaction form', () => {
  it('saves an expense, auto-categorises from the payee, and can be undone', async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = await db.transactions.count();

    await user.type(await screen.findByLabelText('Amount'), '12.5');
    await user.type(screen.getByLabelText('Payee'), 'Pret A Manger');
    const categories = screen.getByRole('radiogroup', { name: 'Category' });
    expect(within(categories).getByRole('radio', { name: 'Eating out' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Save expense' }));

    await waitFor(async () => expect(await db.transactions.count()).toBe(before + 1));
    const saved = await db.transactions.filter((t) => t.payee === 'Pret A Manger' && t.amount === -1250).first();
    expect(saved).toMatchObject({ categoryId: 'eating' });

    // Back on the previous screen with an Undo toast.
    expect(await screen.findByText('Expense saved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await db.transactions.count()).toBe(before));
  });

  it('keeps Save disabled until amount and payee are valid', async () => {
    const user = userEvent.setup();
    render(<App />);
    const save = await screen.findByRole('button', { name: 'Save expense' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Amount'), '1.234');
    await user.type(screen.getByLabelText('Payee'), 'Shop');
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '1.23');
    expect(save).toBeEnabled();
  });

  it('edits an existing transaction and offers a rule when the category changes', async () => {
    const user = userEvent.setup();
    const t = (await db.transactions.filter((x) => x.payee === 'Pret A Manger').first())!;
    window.history.pushState({}, '', `/transactions/${t.id}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Edit expense' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('radiogroup', { name: 'Category' })).getByRole('radio', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => expect((await db.transactions.get(t.id))?.categoryId).toBe('groceries'));
    await user.click(await screen.findByRole('button', { name: 'Always Groceries' }));
    await waitFor(async () => expect(await db.rules.count()).toBe(1));
    expect((await db.rules.toArray())[0]).toMatchObject({ match: 'exact', pattern: 'Pret A Manger', categoryId: 'groceries' });
  });

  it('records a transfer as two linked transactions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('radio', { name: 'Transfer' }));
    await user.type(screen.getByLabelText('Amount'), '50');
    await user.selectOptions(screen.getByLabelText('From'), 'Current account');
    await user.selectOptions(screen.getByLabelText('To'), 'Savings');
    await user.click(screen.getByRole('button', { name: 'Save transfer' }));
    await waitFor(async () => {
      const pair = await db.transactions.filter((x) => !!x.transferId && Math.abs(x.amount) === 5000).toArray();
      expect(pair.map((x) => [x.accountId, x.amount]).sort()).toEqual([
        ['current', -5000],
        ['savings', 5000],
      ]);
    });
  });

  it('splits a payment across categories from the edit screen', async () => {
    const user = userEvent.setup();
    const t = (await db.transactions.filter((x) => x.payee === "Sainsbury's").first())!;
    const total = -t.amount;
    window.history.pushState({}, '', `/transactions/${t.id}`);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Split across categories' }));
    const sheet = screen.getByRole('dialog', { name: 'Split payment' });
    const save = within(sheet).getByRole('button', { name: 'Save split' });
    expect(save).toBeDisabled(); // second part is empty

    await user.selectOptions(within(sheet).getByLabelText('Category for part 2'), 'Shopping');
    await user.type(within(sheet).getByLabelText('Amount for part 2'), '5');
    expect(within(sheet).getByRole('status')).toHaveTextContent('too much');
    await user.click(within(sheet).getByRole('button', { name: 'Balance first part' }));
    expect(within(sheet).getByRole('status')).toHaveTextContent('All assigned');
    await user.click(save);

    await waitFor(async () => {
      const pieces = await db.transactions.filter((x) => x.splitId !== undefined && x.payee === "Sainsbury's").toArray();
      expect(pieces.map((x) => [x.categoryId, x.amount]).sort()).toEqual(
        [
          ['groceries', -(total - 500)],
          ['shopping', -500],
        ].sort(),
      );
    });
    expect(await screen.findByText('Split into 2 parts')).toBeInTheDocument();
  });
});
