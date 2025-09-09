import { defineConfig, devices } from '@playwright/test'

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './tests',
    timeout: 15_000, // Increased timeout for Expo startup
    expect: { timeout: 15_000 },
    /* Run tests serially during stabilization */
    fullyParallel: false,
    workers: 1,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: process.env.CI ? 'line' : [['html', { open: 'never', port: 9324 }]],
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        baseURL: process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:8081',

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',

        /* Take screenshot on failure */
        screenshot: 'only-on-failure',

        /* React Native Web maps testID to data-testid */
        testIdAttribute: 'data-testid',

        /* Mobile-like viewport for React Native Web */
        viewport: { width: 390, height: 844 },
    },

    /* Configure projects for major browsers - limit to Chrome in CI for faster execution */
    projects: process.env.CI
        ? [
              {
                  name: 'chromium',
                  use: { ...devices['Desktop Chrome'] },
              },
          ]
        : [
              {
                  name: 'chromium',
                  use: { ...devices['Desktop Chrome'] },
              },

              {
                  name: 'firefox',
                  use: { ...devices['Desktop Firefox'] },
              },

              {
                  name: 'webkit',
                  use: { ...devices['Desktop Safari'] },
              },

              /* Test against mobile viewports. */
              {
                  name: 'Mobile Chrome',
                  use: { ...devices['Pixel 5'] },
              },
              {
                  name: 'Mobile Safari',
                  use: { ...devices['iPhone 12'] },
              },
          ],
})
