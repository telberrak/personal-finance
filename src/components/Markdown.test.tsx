import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders headings, lists, bold and safe links, and never raw HTML', () => {
    render(
      <Markdown
        source={
          '# Title\n\nSome **bold** text with a [link](https://example.com).\n\n- one\n- two <script>alert(1)</script>\n\n[bad](javascript:alert(1))'
        }
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('href', 'https://example.com');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(document.querySelector('script')).toBeNull();
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull(); // javascript: links stay plain text
  });
});
