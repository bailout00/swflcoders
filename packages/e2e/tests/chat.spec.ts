import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

// Test data
const USER1_NAME = 'Alice';
const USER2_NAME = 'Bob';
const TEST_MESSAGE_1 = 'Hello from Alice!';
const TEST_MESSAGE_2 = 'Hi Alice, this is Bob responding!';

test.describe('Chat Functionality', () => {
  let browser: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;

  test.beforeAll(async ({ browserName }, testInfo) => {
    // Create browser instance for multiple contexts
    const { chromium, firefox, webkit } = require('@playwright/test');
    const browserTypes = { chromium, firefox, webkit };
    browser = await browserTypes[browserName].launch();
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test.beforeEach(async () => {
    // Create separate browser contexts for each user
    // This ensures completely isolated localStorage/sessions
    context1 = await browser.newContext();
    context2 = await browser.newContext();
    
    page1 = await context1.newPage();
    page2 = await context2.newPage();
    
    // Navigate both pages to the chat tab
    await page1.goto('/');
    await page2.goto('/');
    
    // Navigate to chat tab (assuming it's the second tab)
    await page1.click('[role="tab"]:nth-child(2)');
    await page2.click('[role="tab"]:nth-child(2)');
  });

  test.afterEach(async () => {
    await context1?.close();
    await context2?.close();
  });

  test('should allow setting username on both contexts', async () => {
    // Check that both users see the username input screen
    await expect(page1.getByText('Welcome to Chat!')).toBeVisible();
    await expect(page2.getByText('Welcome to Chat!')).toBeVisible();
    
    // Set username for user 1
    await page1.getByPlaceholder('Enter your name').fill(USER1_NAME);
    await page1.getByRole('button', { name: 'Set Username' }).click();
    
    // Set username for user 2
    await page2.getByPlaceholder('Enter your name').fill(USER2_NAME);
    await page2.getByRole('button', { name: 'Set Username' }).click();
    
    // Verify both users are now in the chat interface
    await expect(page1.getByText('Chat')).toBeVisible();
    await expect(page1.getByText(USER1_NAME)).toBeVisible(); // Username in header
    
    await expect(page2.getByText('Chat')).toBeVisible();
    await expect(page2.getByText(USER2_NAME)).toBeVisible(); // Username in header
  });

  test('should validate username input', async () => {
    // Test empty username
    await page1.getByRole('button', { name: 'Set Username' }).click();
    await expect(page1.getByText('Please enter a username')).toBeVisible();
    
    // Test short username
    await page1.getByPlaceholder('Enter your name').fill('A');
    await page1.getByRole('button', { name: 'Set Username' }).click();
    await expect(page1.getByText('Username must be at least 2 characters long')).toBeVisible();
    
    // Test valid username
    await page1.getByPlaceholder('Enter your name').fill(USER1_NAME);
    await page1.getByRole('button', { name: 'Set Username' }).click();
    await expect(page1.getByText('Chat')).toBeVisible();
  });

  test('should send and receive messages between users', async () => {
    // Set up both users
    await setupUser(page1, USER1_NAME);
    await setupUser(page2, USER2_NAME);
    
    // Wait for chat interface to be ready
    await expect(page1.getByText('No messages yet. Start the conversation!')).toBeVisible();
    await expect(page2.getByText('No messages yet. Start the conversation!')).toBeVisible();
    
    // User 1 sends a message
    await page1.getByPlaceholder('Type a message...').fill(TEST_MESSAGE_1);
    // Send button is circular with an icon, so we'll use a more specific selector
    await page1.locator('button[aria-disabled="false"]').last().click();
    
    // Wait a bit for the message to be processed and for refetch interval
    await page1.waitForTimeout(1500);
    
    // Verify message appears on user 1's screen (their own message)
    await expect(page1.getByText(TEST_MESSAGE_1)).toBeVisible();
    
    // Wait for the automatic refetch (every 3 seconds) to get new messages on user 2's screen
    await page2.waitForTimeout(4000);
    
    // Verify message appears on user 2's screen (received message)
    await expect(page2.getByText(TEST_MESSAGE_1)).toBeVisible();
    await expect(page2.getByText(USER1_NAME)).toBeVisible(); // Sender's name should be visible
    
    // User 2 responds
    await page2.getByPlaceholder('Type a message...').fill(TEST_MESSAGE_2);
    await page2.locator('button[aria-disabled="false"]').last().click();
    
    // Wait for message processing and refetch
    await page2.waitForTimeout(1500);
    
    // Verify user 2 sees their own message
    await expect(page2.getByText(TEST_MESSAGE_2)).toBeVisible();
    
    // Wait for user 1's refetch to get the new message
    await page1.waitForTimeout(4000);
    
    // Verify user 1 sees both messages
    await expect(page1.getByText(TEST_MESSAGE_1)).toBeVisible();
    await expect(page1.getByText(TEST_MESSAGE_2)).toBeVisible();
    await expect(page1.getByText(USER2_NAME)).toBeVisible(); // User 2's name should be visible
  });

  test('should handle message input states correctly', async () => {
    await setupUser(page1, USER1_NAME);
    
    const messageInput = page1.getByPlaceholder('Type a message...');
    const sendButton = page1.locator('button').last(); // The send button (circular with icon)
    
    // Send button should be disabled when input is empty
    await expect(sendButton).toBeDisabled();
    
    // Send button should be enabled when input has text
    await messageInput.fill('Test message');
    await expect(sendButton).toBeEnabled();
    
    // Input should clear after sending
    await sendButton.click();
    await expect(messageInput).toHaveValue('');
    await expect(sendButton).toBeDisabled();
  });

  test('should show message timestamps', async () => {
    await setupUser(page1, USER1_NAME);
    
    // Send a message
    await page1.getByPlaceholder('Type a message...').fill(TEST_MESSAGE_1);
    await page1.locator('button').last().click();
    
    // Wait for message to appear
    await expect(page1.getByText(TEST_MESSAGE_1)).toBeVisible();
    
    // Check that a timestamp is displayed (should be in HH:MM format)
    const timestampRegex = /^\d{1,2}:\d{2}$/;
    await expect(page1.locator('text=' + timestampRegex.source)).toBeVisible();
  });

  test('should allow logout and re-login', async () => {
    await setupUser(page1, USER1_NAME);
    
    // Logout
    await page1.getByRole('button', { name: 'Logout' }).click();
    
    // Should be back to username input
    await expect(page1.getByText('Welcome to Chat!')).toBeVisible();
    
    // Re-login with different name
    await page1.getByPlaceholder('Enter your name').fill('NewUser');
    await page1.getByRole('button', { name: 'Set Username' }).click();
    
    // Should be in chat with new username
    await expect(page1.getByText('Chat')).toBeVisible();
    await expect(page1.getByText('NewUser')).toBeVisible();
  });

  test('should persist username across page reloads', async () => {
    await setupUser(page1, USER1_NAME);
    
    // Reload the page
    await page1.reload();
    await page1.click('[role="tab"]:nth-child(2)');
    
    // Should still be logged in with the same username
    await expect(page1.getByText('Chat')).toBeVisible();
    await expect(page1.getByText(USER1_NAME)).toBeVisible();
  });

  test('should handle network errors gracefully', async () => {
    await setupUser(page1, USER1_NAME);
    
    // Simulate network failure by going offline
    await page1.context().setOffline(true);
    
    // Try to send a message
    await page1.getByPlaceholder('Type a message...').fill('This should fail');
    await page1.locator('button').last().click();
    
    // The app should handle this gracefully (exact behavior depends on implementation)
    // At minimum, it shouldn't crash the page
    await expect(page1.getByText('Chat')).toBeVisible();
    
    // Restore network
    await page1.context().setOffline(false);
  });

  test('should display empty state correctly', async () => {
    await setupUser(page1, USER1_NAME);
    
    // Should show empty state message
    await expect(page1.getByText('No messages yet. Start the conversation!')).toBeVisible();
  });

  // Helper function to set up a user
  async function setupUser(page: Page, username: string) {
    // Fill and submit username
    await page.getByPlaceholder('Enter your name').fill(username);
    await page.getByRole('button', { name: 'Set Username' }).click();
    
    // Wait for chat interface to load
    await expect(page.getByText('Chat')).toBeVisible();
    await expect(page.getByText(username)).toBeVisible();
  }
});
