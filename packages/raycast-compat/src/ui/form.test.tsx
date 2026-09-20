/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Form } from './Form';
import { ActionPanel, Action } from './ActionPanel';

describe('Form Component', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders all form input fields and descriptions', () => {
    render(
      <Form navigationTitle="Create Note">
        <Form.Description text="Fill in the details below to create a new note." />
        <Form.TextField id="title" title="Title" placeholder="Enter title" defaultValue="My Note" />
        <Form.PasswordField id="secret" title="Secret" placeholder="Enter secret" />
        <Form.TextArea id="body" title="Content" placeholder="Enter content" />
        <Form.Checkbox id="pin" label="Pin to top" defaultValue={true} />
        <Form.Dropdown id="category" title="Category" defaultValue="work">
          <Form.Dropdown.Item value="personal" title="Personal" />
          <Form.Dropdown.Item value="work" title="Work" />
        </Form.Dropdown>
        <Form.DatePicker id="reminder" title="Reminder Date" />
        <Form.Separator />
      </Form>,
    );

    expect(screen.getByText('Create Note')).toBeDefined();
    expect(screen.getByText('Fill in the details below to create a new note.')).toBeDefined();
    expect(screen.getByPlaceholderText('Enter title')).toBeDefined();
    expect(screen.getByPlaceholderText('Enter secret')).toBeDefined();
    expect(screen.getByPlaceholderText('Enter content')).toBeDefined();
    expect(screen.getByText('Pin to top')).toBeDefined();
    expect(screen.getByText('Category')).toBeDefined();
    expect(screen.getByText('Reminder Date')).toBeDefined();
  });

  it('renders field validation errors when error prop is provided', () => {
    render(
      <Form>
        <Form.TextField id="username" title="Username" error="Username is already taken" />
      </Form>,
    );

    expect(screen.getByText('Username is already taken')).toBeDefined();
  });

  it('submits form values when SubmitForm action is triggered', () => {
    const handleSubmit = vi.fn();

    render(
      <Form
        actions={
          <ActionPanel>
            <Action.SubmitForm title="Save Note" onSubmit={handleSubmit} />
          </ActionPanel>
        }
      >
        <Form.TextField id="title" title="Title" placeholder="Title" defaultValue="First Title" />
        <Form.Checkbox id="isPublic" label="Make Public" defaultValue={false} />
      </Form>,
    );

    const titleInput = screen.getByPlaceholderText('Title');
    fireEvent.change(titleInput, { target: { value: 'Updated Title' } });

    const checkbox = screen.getByLabelText('Make Public');
    fireEvent.click(checkbox);

    const submitBtn = screen.getByText('Save Note');
    fireEvent.click(submitBtn);

    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Updated Title',
        isPublic: true,
      }),
    );
  });
});
