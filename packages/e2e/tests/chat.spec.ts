import { expect } from '@playwright/test'
import { test, testWithUserPersistence } from './fixtures'

// Test data
const TEST_USERNAME = 'Alice'
const TEST_MESSAGE = 'Hello, this is a test message!'

test.describe('Chat Functionality', () => {
    // Helper function to navigate to chat tab
    async function navigateToChat(page: any) {
        await page.goto('/')

        // Try to click the Chat tab via role=link first
        const chatTab = page.getByRole('link', { name: /^chat$/i })
        if (await chatTab.count()) {
            await chatTab.first().click()
        } else {
            // Fallback to direct navigation if tab not found
            await page.goto('/chat')
        }

        // Wait for page to load
        await page.waitForLoadState('networkidle')

        // Wait for either the logout button (user is logged in) or username input (user store hydrated but no user)
        await Promise.race([
            page.waitForSelector('[data-testid="logout-button"]', { timeout: 5000 }),
            page.waitForSelector('[data-testid="username-input"]', { timeout: 5000 }),
        ])
    }

    // Helper function to set up a user
    async function setupUser(page: any, username: string) {
        await navigateToChat(page)

        // Fill and submit username using testIDs
        const nameInput = page.getByTestId('username-input')
        await expect(nameInput).toBeVisible()
        await nameInput.fill(username)

        const submit = page.getByTestId('username-submit-button')
        await submit.click()

        // Wait for chat interface to load
        const logoutButton = page.getByTestId('logout-button')
        await expect(logoutButton).toBeVisible()

        // Verify username appears in header (use first() to avoid conflicts)
        await expect(page.getByText(username).first()).toBeVisible()
    }

    test('navigates to Chat tab and sets username', async ({ page }) => {
        await navigateToChat(page)

        // Username input should be visible
        const nameInput = page.getByTestId('username-input')
        await expect(nameInput).toBeVisible()
        await nameInput.fill(TEST_USERNAME)

        const submit = page.getByTestId('username-submit-button')
        await submit.click()

        // Wait for ChatInterface to appear
        const logout = page.getByTestId('logout-button')
        await expect(logout).toBeVisible()

        // Verify username appears in header (use first() to avoid conflicts)
        await expect(page.getByText(TEST_USERNAME).first()).toBeVisible()
    })

    test('validates username input', async ({ page }) => {
        await navigateToChat(page)

        // Test empty username
        const submit = page.getByTestId('username-submit-button')
        await submit.click()
        await expect(page.getByText('Please enter a username')).toBeVisible()

        // Test short username
        const nameInput = page.getByTestId('username-input')
        await nameInput.fill('A')
        await submit.click()
        await expect(page.getByText('Username must be at least 2 characters long')).toBeVisible()

        // Test valid username
        await nameInput.fill(TEST_USERNAME)
        await submit.click()
        await expect(page.getByTestId('logout-button')).toBeVisible()
    })

    test('handles message input correctly', async ({ page }) => {
        await setupUser(page, TEST_USERNAME)

        // Check message input functionality
        const messageInput = page.getByTestId('message-input')
        const sendButton = page.getByTestId('send-message-button')

        // Send button should be disabled when input is empty
        await expect(sendButton).toBeDisabled()

        // Send button should be enabled when input has text
        await messageInput.fill(TEST_MESSAGE)
        await expect(sendButton).toBeEnabled()

        // Input should clear after sending
        await sendButton.click()
        await expect(messageInput).toHaveValue('')
        await expect(sendButton).toBeDisabled()
    })

    test('logout returns to username input', async ({ page }) => {
        await setupUser(page, TEST_USERNAME)

        // Logout
        await page.getByTestId('logout-button').click()

        // Should be back to username input
        await expect(page.getByTestId('username-input')).toBeVisible()
        await expect(page.getByText('Welcome to Chat!')).toBeVisible()
    })

    testWithUserPersistence('persists username across page reloads', async ({ page }) => {
        await setupUser(page, TEST_USERNAME)

        // Reload the page
        console.log('Reloading page...')
        await page.reload()

        console.log('Navigating to chat after reload...')
        await navigateToChat(page)

        // Wait a bit more for the user store to hydrate and determine the state
        await page.waitForTimeout(1000)

        // Check which component is rendered
        const logoutButton = page.getByTestId('logout-button')
        const usernameInput = page.getByTestId('username-input')

        if ((await logoutButton.count()) > 0) {
            // Should still be logged in with the same username
            await expect(page.getByTestId('logout-button')).toBeVisible()

            // Check for username in the header (use first() to avoid conflicts with chat messages)
            await expect(page.getByText(TEST_USERNAME).first()).toBeVisible()
        } else if ((await usernameInput.count()) > 0) {
            console.log('❌ User store was cleared - back to username input')
            // If we're back to username input, the persistence failed
            // This would be the case if the fixture clearing affected user data
            throw new Error('User persistence failed - user store was cleared after reload')
        } else {
            console.log('❓ Neither logout button nor username input found')
            throw new Error('Unable to determine user state after reload')
        }
    })
})
