/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Detail } from './Detail';
import { ActionPanel, Action } from './ActionPanel';

describe('Detail Component', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders markdown headings, lists, code blocks, and blockquotes', () => {
    const md = `
# Main Title
## Section Subtitle
### Sub-section

> Important blockquote message

- First list item
- Second list item

\`\`\`typescript
const foo = "bar";
\`\`\`

Here is **bold text** and \`inline code\`.
`;

    render(<Detail markdown={md} navigationTitle="Documentation View" />);

    expect(screen.getByText('Documentation View')).toBeDefined();
    expect(screen.getByText('Main Title')).toBeDefined();
    expect(screen.getByText('Section Subtitle')).toBeDefined();
    expect(screen.getByText('Sub-section')).toBeDefined();
    expect(screen.getByText('Important blockquote message')).toBeDefined();
    expect(screen.getByText('First list item')).toBeDefined();
    expect(screen.getByText('Second list item')).toBeDefined();
    expect(screen.getByText('bold text')).toBeDefined();
    expect(screen.getByText('inline code')).toBeDefined();
    expect(screen.getByText(/const foo = "bar";/)).toBeDefined();
  });

  it('renders metadata sidebar with labels, links, and tags', () => {
    render(
      <Detail
        markdown="# Package Information"
        metadata={
          <Detail.Metadata>
            <Detail.Metadata.Label title="Version" text="2.4.0" />
            <Detail.Metadata.Label title="Author" text="Asyar Core Team" />
            <Detail.Metadata.Link
              title="Repository"
              target="https://github.com/asyar/asyar"
              text="GitHub Repo"
            />
            <Detail.Metadata.Separator />
            <Detail.Metadata.TagList title="Categories">
              <Detail.Metadata.TagList.Item text="Developer" color="#3b82f6" />
              <Detail.Metadata.TagList.Item text="Productivity" color="#10b981" />
            </Detail.Metadata.TagList>
          </Detail.Metadata>
        }
      />,
    );

    expect(screen.getByText('Version')).toBeDefined();
    expect(screen.getByText('2.4.0')).toBeDefined();
    expect(screen.getByText('Author')).toBeDefined();
    expect(screen.getByText('Asyar Core Team')).toBeDefined();
    expect(screen.getByText('Repository')).toBeDefined();
    expect(screen.getByText('GitHub Repo')).toBeDefined();
    expect(screen.getByText('Categories')).toBeDefined();
    expect(screen.getByText('Developer')).toBeDefined();
    expect(screen.getByText('Productivity')).toBeDefined();
  });

  it('renders bottom action bar and executes primary action', () => {
    const handleAction = vi.fn();

    render(
      <Detail
        markdown="# With Actions"
        actions={
          <ActionPanel>
            <Action title="Copy Details" onAction={handleAction} />
          </ActionPanel>
        }
      />,
    );

    const actionBtn = screen.getByText('Copy Details');
    expect(actionBtn).toBeDefined();

    fireEvent.click(actionBtn);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it('displays loading indicator when isLoading is true', () => {
    render(<Detail isLoading navigationTitle="Fetching Docs" />);

    expect(screen.getByText('Fetching Docs')).toBeDefined();
    expect(screen.getByText('Loading…')).toBeDefined();
    expect(screen.getByText('Loading content…')).toBeDefined();
  });
});
