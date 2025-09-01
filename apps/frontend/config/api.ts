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

// Environment detection
const isDevelopment = process.env.NODE_ENV === 'development'

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

// Production configuration (deployed backend)
const productionConfig: ApiConfig = {
    rest: {
        baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || 'https://your-api.amazonaws.com',
        endpoints: {
            messages: '/chat/messages',
            health: '/health',
        },
    },
    websocket: {
        url: process.env.NEXT_PUBLIC_WS_URL || 'wss://your-websocket-api.amazonaws.com',
    },
}

// Export the appropriate configuration based on environment
export const apiConfig = isDevelopment ? developmentConfig : productionConfig

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
