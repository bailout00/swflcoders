import { test as base } from '@playwright/test'

export const test = base.extend({
    context: async ({ context }, use) => {
        // Clear storage before each test to ensure clean state for Zustand + AsyncStorage
        await context.addInitScript(() => {
            try {
                localStorage.clear()
            } catch {}
            try {
                sessionStorage.clear()
            } catch {}
            // Clear any React Query cache keys that might be stored
            try {
                Object.keys(localStorage).forEach((key) => {
                    if (key.startsWith('REACT_QUERY_OFFLINE_CACHE')) {
                        localStorage.removeItem(key)
                    }
                })
            } catch {}
        })
        await use(context)
    },
})

// Test fixture that preserves user data for persistence tests
export const testWithUserPersistence = base.extend({
    context: async ({ context }, use) => {
        // Only clear non-user related storage to preserve user state for persistence tests
        await context.addInitScript(() => {
            try {
                // Clear everything except user store data
                const userStoreKeys = Object.keys(localStorage).filter(
                    (key) =>
                        key.includes('user-storage') ||
                        key.includes('zustand') ||
                        key.includes('chat-app') ||
                        key.startsWith('user-')
                )

                // Preserve user store data
                const preservedData: Record<string, string> = {}
                userStoreKeys.forEach((key) => {
                    preservedData[key] = localStorage.getItem(key) || ''
                })

                // Clear storage
                localStorage.clear()
                sessionStorage.clear()

                // Restore user store data
                Object.entries(preservedData).forEach(([key, value]) => {
                    localStorage.setItem(key, value)
                })

                // Clear React Query cache
                try {
                    Object.keys(localStorage).forEach((key) => {
                        if (key.startsWith('REACT_QUERY_OFFLINE_CACHE')) {
                            localStorage.removeItem(key)
                        }
                    })
                } catch {}
            } catch (error) {
                console.warn('Failed to preserve user data in test setup:', error)
            }
        })
        await use(context)
    },
})

export const expect = base.expect
