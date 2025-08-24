import { test, expect } from '@playwright/test';
import type { HealthCheck, HealthStatus } from '@swflcoders/types';

test.describe('Health Check', () => {
  test('should return healthy status from API', async ({ request }) => {
    // Use HEALTH_URL from pipeline environment, fallback to API_URL + /health, or default
    const healthUrl = process.env.HEALTH_URL || 
                     (process.env.API_URL ? `${process.env.API_URL}health` : null) ||
                     'https://api.swflcoders.com/health';
    
    console.log(`Testing health endpoint: ${healthUrl}`);
    const response = await request.get(healthUrl);
    
    expect(response.status()).toBe(200);
    
    const healthCheck: HealthCheck = await response.json();
    expect(healthCheck.status).toBe('Healthy');
    expect(healthCheck.version).toBeTruthy();
    expect(healthCheck.timestamp).toBeTruthy();
    
    // Log stage info for pipeline debugging
    if (process.env.STAGE) {
      console.log(`Health check passed for stage: ${process.env.STAGE}`);
      expect(healthCheck.stage).toBe(process.env.STAGE);
    }
  });

  test('should load frontend app', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the app to load
    await expect(page).toHaveTitle(/.*Swflcoders.*|.*Frontend.*/i);
    
    // Check that the page loads without major errors
    await expect(page.locator('body')).toBeVisible();
  });
});
