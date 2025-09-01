// Environment configuration for API and WebSocket endpoints
export const API_BASE_URL =
    process.env.EXPO_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || 'http://127.0.0.1:3000'

export const WS_URL = process.env.EXPO_PUBLIC_WS_URL || process.env.WS_URL || '' // set to deployed wss://... when available

export const DEFAULT_ROOM_ID = 'general'
