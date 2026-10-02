import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm } from './Dialog';

function Harness() {
  const confirm = useConfirm();
  const [result, setResult] = useState('none');
  const ask = async () => setResult(String(await confirm({ title: 'Erase all data?', confirmLabel: 'Erase', danger: true })));
  return (
    <button type="button" onClick={ask}>
      Ask ({result})
    </button>
  );
}

describe('useConfirm', () => {
  it('resolves true on confirm and false on cancel', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <Harness />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Ask (none)' }));
    expect(screen.getByText('Erase all data?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Erase' }));
    expect(await screen.findByRole('button', { name: 'Ask (true)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ask (true)' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Ask (false)' })).toBeInTheDocument();
  });
});
