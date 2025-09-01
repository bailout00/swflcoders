/**
 * API Configuration for Chat Application
 *
 * This file defines the endpoints for both REST API and WebSocket connections
 * for development and production environments.
 */

interface ApiConfig {
    rest: {
        baseUrl: string
        endpoints: {
            messages: string
            health: string
        }
    }
    websocket: {
        url: string
    }
}

// Helper to get current hostname in the browser; hard-fail if unavailable
const getCurrentHostnameOrThrow = (): string => {
    if (typeof window === 'undefined' || !window.location?.hostname) {
        throw new Error('Hostname is not available at runtime. Cannot derive API endpoints.')
    }
    return window.location.hostname
}

const currentHostname = getCurrentHostnameOrThrow()
const isLocalHostName =
    /localhost/i.test(currentHostname) ||
    currentHostname === '127.0.0.1' ||
    currentHostname === '::1'

// Development configuration (local backend)
const developmentConfig: ApiConfig = {
    rest: {
        baseUrl: 'http://localhost:3001',
        endpoints: {
            messages: '/chat/messages',
            health: '/health',
        },
    },
    websocket: {
        // WebSocket URL for local development - same server as REST API
        url: 'ws://localhost:3001/ws',
    },
}

// Production configuration (deployed backend) derived strictly from current hostname
const productionConfig: ApiConfig = (() => {
    const hostname = currentHostname
    const restBase = `https://api.${hostname}`
    const wsUrl = `wss://ws.${hostname}`

    return {
        rest: {
            baseUrl: restBase,
            endpoints: {
                messages: '/chat/messages',
                health: '/health',
            },
        },
        websocket: {
            url: wsUrl,
        },
    }
})()

// Export the appropriate configuration based on environment
// Prefer localhost URLs whenever hostname indicates local
export const apiConfig = isLocalHostName ? developmentConfig : productionConfig

// Helper functions for building full URLs
export const getRestUrl = (endpoint: keyof typeof apiConfig.rest.endpoints): string => {
    return `${apiConfig.rest.baseUrl}${apiConfig.rest.endpoints[endpoint]}`
}

export const getWebSocketUrl = (params?: {
    roomId?: string
    userId?: string
    username?: string
}): string => {
    const url = new URL(apiConfig.websocket.url)

    if (params) {
        if (params.roomId) url.searchParams.set('room_id', params.roomId)
        if (params.userId) url.searchParams.set('userId', params.userId)
        if (params.username) url.searchParams.set('username', params.username)
    }

    return url.toString()
}

// Room configuration
export const DEFAULT_ROOM_ID = 'general'

// Export configuration object for direct access
export default apiConfig
