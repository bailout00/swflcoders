import { test, expect } from '@playwright/test';
import type { HealthCheck, HealthStatus } from '@swflcoders/types';

test.describe('Health Check', () => {
  test('should return healthy status from API', async ({ request }) => {
    const baseUrl = process.env.API_BASE_URL || 'https://api.swflcoders.com';
    const response = await request.get(`${baseUrl}/health`);
    
    expect(response.status()).toBe(200);
    
    const healthCheck: HealthCheck = await response.json();
    expect(healthCheck.status).toBe('Healthy');
    expect(healthCheck.version).toBeTruthy();
    expect(healthCheck.timestamp).toBeTruthy();
  });

  test('should load frontend app', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the app to load
    await expect(page).toHaveTitle(/.*Swflcoders.*|.*Frontend.*/i);
    
    // Check that the page loads without major errors
    await expect(page.locator('body')).toBeVisible();
  });
});
