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

  it('renders numbered steps, example boxes and heading anchors', () => {
    const { container } = render(
      <Markdown
        source={'## Bills {#bills}\n\n1. Enter the amount.\n2. Choose how often.\n\n> **Example:** Council Tax, £148.\n\n- a bullet'}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Bills' })).toHaveAttribute('id', 'bills');
    expect(container.querySelector('ol')?.children).toHaveLength(2);
    expect(container.querySelector('ul')?.children).toHaveLength(1);
    expect(container.querySelector('blockquote.example')).toHaveTextContent('Example: Council Tax, £148.');
  });
});
