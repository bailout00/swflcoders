import { useEffect, useRef, useState, useCallback } from 'react'
import { useUserStore } from '../stores/userStore'
import { getWebSocketUrl, DEFAULT_ROOM_ID } from '../config/api'
import { type ChatMessage, chatMessageToMessage } from '../types/chat'
import { useOptimisticMessage } from './useChatQueries'

export interface UseChatSocketOptions {
    roomId?: string
    autoConnect?: boolean
    reconnectInterval?: number
    maxReconnectAttempts?: number
}

export interface UseChatSocketReturn {
    isConnected: boolean
    isConnecting: boolean
    connectionError: string | null
    connect: () => void
    disconnect: () => void
    reconnectCount: number
}

/**
 * WebSocket hook for real-time chat functionality
 *
 * Handles connection management, message receiving, deduplication,
 * and automatic reconnection with exponential backoff.
 */
export function useChatSocket(options: UseChatSocketOptions = {}): UseChatSocketReturn {
    const {
        roomId = DEFAULT_ROOM_ID,
        autoConnect = true,
        reconnectInterval = 1000,
        maxReconnectAttempts = 5,
    } = options

    // State
    const [isConnected, setIsConnected] = useState(false)
    const [isConnecting, setIsConnecting] = useState(false)
    const [connectionError, setConnectionError] = useState<string | null>(null)
    const [reconnectCount, setReconnectCount] = useState(0)

    // Refs
    const wsRef = useRef<WebSocket | null>(null)
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const reconnectAttemptsRef = useRef(0)

    // User store
    const userId = useUserStore((state) => state.getUserId())
    const username = useUserStore((state) => state.username)

    // Hook for adding messages to cache
    const { addMessage } = useOptimisticMessage(roomId)

    // Clean up function
    const cleanup = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close()
            wsRef.current = null
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = null
        }
        setIsConnected(false)
        setIsConnecting(false)
    }, [])

    // Connect function
    const connect = useCallback(() => {
        // Don't connect if already connected or connecting
        if (wsRef.current?.readyState === WebSocket.OPEN || isConnecting) {
            return
        }

        // Don't connect if user is not ready
        if (!userId || !username) {
            console.warn('Cannot connect to WebSocket: userId and username are required')
            setConnectionError('User not ready')
            return
        }

        setIsConnecting(true)
        setConnectionError(null)

        try {
            const wsUrl = getWebSocketUrl({
                roomId,
                userId,
                username,
            })

            console.log('Connecting to WebSocket:', wsUrl)
            const ws = new WebSocket(wsUrl)

            ws.onopen = () => {
                console.log('WebSocket connected')
                setIsConnected(true)
                setIsConnecting(false)
                setConnectionError(null)
                reconnectAttemptsRef.current = 0
                setReconnectCount(0)
            }

            ws.onmessage = (event) => {
                try {
                    const chatMessage: ChatMessage = JSON.parse(event.data)
                    console.log('Received WebSocket message:', chatMessage)

                    // Convert to frontend Message format
                    const message = chatMessageToMessage(chatMessage, userId)

                    // Add to message cache (with deduplication)
                    addMessage(message)
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error)
                }
            }

            ws.onclose = (event) => {
                console.log('WebSocket closed:', event.code, event.reason)
                setIsConnected(false)
                setIsConnecting(false)

                // Only attempt reconnect if it wasn't a manual close
                if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
                    attemptReconnect()
                }
            }

            ws.onerror = (error) => {
                console.error('WebSocket error:', error)
                setConnectionError('WebSocket connection failed')
                setIsConnecting(false)
            }

            wsRef.current = ws
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error)
            setConnectionError(error instanceof Error ? error.message : 'Connection failed')
            setIsConnecting(false)
        }
    }, [userId, username, roomId, isConnecting, maxReconnectAttempts, addMessage])

    // Disconnect function
    const disconnect = useCallback(() => {
        console.log('Manually disconnecting WebSocket')
        cleanup()
    }, [cleanup])

    // Attempt reconnect with exponential backoff
    const attemptReconnect = useCallback(() => {
        if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            console.log('Max reconnect attempts reached')
            setConnectionError('Connection failed after multiple attempts')
            return
        }

        const backoffDelay = reconnectInterval * 2 ** reconnectAttemptsRef.current
        reconnectAttemptsRef.current++
        setReconnectCount(reconnectAttemptsRef.current)

        console.log(
            `Attempting reconnect ${reconnectAttemptsRef.current}/${maxReconnectAttempts} in ${backoffDelay}ms`
        )

        reconnectTimeoutRef.current = setTimeout(() => {
            connect()
        }, backoffDelay)
    }, [connect, reconnectInterval, maxReconnectAttempts])

    // Auto-connect on mount and when user becomes ready
    useEffect(() => {
        if (autoConnect && userId && username) {
            connect()
        }

        // Cleanup on unmount
        return cleanup
    }, [autoConnect, userId, username, connect, cleanup])

    // Clean up timeouts on unmount
    useEffect(() => {
        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current)
            }
        }
    }, [])

    return {
        isConnected,
        isConnecting,
        connectionError,
        connect,
        disconnect,
        reconnectCount,
    }
}
