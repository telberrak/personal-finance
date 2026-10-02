import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { db } from '../db/db';
import { seedIfEmpty } from '../db/seed';
import { resetDb } from '../test/utils';

beforeEach(async () => {
  await resetDb();
  await seedIfEmpty();
  window.history.pushState({}, '', '/add');
});

describe('Add transaction', () => {
  it('saves an expense, auto-categorises from the payee, and can be undone', async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = await db.transactions.count();

    await user.type(await screen.findByLabelText('Amount in pounds'), '12.5');
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
    await user.type(screen.getByLabelText('Amount in pounds'), '1.234');
    await user.type(screen.getByLabelText('Payee'), 'Shop');
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('Amount in pounds'));
    await user.type(screen.getByLabelText('Amount in pounds'), '1.23');
    expect(save).toBeEnabled();
  });
});
