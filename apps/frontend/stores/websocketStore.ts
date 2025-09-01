import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { AppState } from 'react-native'
import { getWebSocketUrl, DEFAULT_ROOM_ID } from '../config/api'
import { type Message, type ChatMessage, chatMessageToMessage } from '../types/chat'

export interface WebSocketState {
    // Connection state
    socket: WebSocket | null
    isConnected: boolean
    isConnecting: boolean
    connectionError: string | null
    reconnectCount: number

    // Current room and user info
    currentRoomId: string
    currentUserId: string | null
    currentUsername: string | null

    // Actions
    connect: (roomId: string, userId: string, username: string) => void
    disconnect: () => void
    sendMessage: (message: string) => void

    // Internal actions (not for external use)
    _setSocket: (socket: WebSocket | null) => void
    _setConnectionState: (state: {
        isConnected?: boolean
        isConnecting?: boolean
        connectionError?: string | null
        reconnectCount?: number
    }) => void
    _handleMessage: (message: ChatMessage) => void
}

// Global message handler - this will be used by other stores/hooks
let globalMessageHandler: ((message: Message) => void) | null = null

export const setGlobalMessageHandler = (handler: (message: Message) => void) => {
    globalMessageHandler = handler
}

export const useWebSocketStore = create<WebSocketState>()(
    subscribeWithSelector((set, get) => ({
        // Initial state
        socket: null,
        isConnected: false,
        isConnecting: false,
        connectionError: null,
        reconnectCount: 0,
        currentRoomId: DEFAULT_ROOM_ID,
        currentUserId: null,
        currentUsername: null,

        // Connect to WebSocket
        connect: (roomId: string, userId: string, username: string) => {
            const state = get()

            // Don't connect if already connected to the same room with same user
            if (
                state.socket?.readyState === WebSocket.OPEN &&
                state.currentRoomId === roomId &&
                state.currentUserId === userId &&
                state.currentUsername === username
            ) {
                console.log('Already connected to the same room with same user')
                return
            }

            // Disconnect existing connection first
            if (state.socket) {
                console.log('Disconnecting existing WebSocket connection')
                state.socket.close()
            }

            console.log(`Connecting to WebSocket: room=${roomId}, user=${username} (${userId})`)

            set({
                isConnecting: true,
                connectionError: null,
                currentRoomId: roomId,
                currentUserId: userId,
                currentUsername: username,
            })

            try {
                const wsUrl = getWebSocketUrl({
                    roomId,
                    userId,
                    username,
                })

                console.log('WebSocket URL:', wsUrl)
                const ws = new WebSocket(wsUrl)

                ws.onopen = () => {
                    console.log('WebSocket connected successfully')
                    set({
                        socket: ws,
                        isConnected: true,
                        isConnecting: false,
                        connectionError: null,
                        reconnectCount: 0,
                    })
                }

                ws.onmessage = (event) => {
                    try {
                        const chatMessage: ChatMessage = JSON.parse(event.data)
                        console.log('Received WebSocket message:', chatMessage)

                        // Convert to frontend Message format
                        const message = chatMessageToMessage(chatMessage, userId)

                        // Call global message handler if available
                        if (globalMessageHandler) {
                            globalMessageHandler(message)
                        }

                        // Also trigger the internal handler for any additional processing
                        get()._handleMessage(chatMessage)
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error)
                    }
                }

                ws.onclose = (event) => {
                    console.log('WebSocket closed:', event.code, event.reason)
                    set({
                        socket: null,
                        isConnected: false,
                        isConnecting: false,
                    })

                    // Auto-reconnect if it wasn't a manual close (code 1000)
                    if (event.code !== 1000) {
                        const currentState = get()
                        const newReconnectCount = currentState.reconnectCount + 1

                        if (newReconnectCount <= 5) {
                            const delayMs = 1000 * 2 ** (newReconnectCount - 1)
                            console.log(
                                `Attempting reconnection ${newReconnectCount}/5 in ${delayMs}ms`
                            )
                            set({ reconnectCount: newReconnectCount })

                            setTimeout(
                                () => {
                                    const latestState = get()
                                    if (latestState.currentUserId && latestState.currentUsername) {
                                        latestState.connect(
                                            latestState.currentRoomId,
                                            latestState.currentUserId,
                                            latestState.currentUsername
                                        )
                                    }
                                },
                                1000 * 2 ** (newReconnectCount - 1)
                            ) // Exponential backoff: 1s, 2s, 4s, 8s, 16s
                        } else {
                            set({
                                connectionError: 'Connection failed after multiple attempts',
                                reconnectCount: 0,
                            })
                        }
                    }
                }

                ws.onerror = (error) => {
                    console.error('WebSocket error:', error)
                    set({
                        socket: null,
                        isConnected: false,
                        isConnecting: false,
                        connectionError: 'WebSocket connection failed',
                    })
                }

                // Store the socket immediately so we can reference it
                set({ socket: ws })
            } catch (error) {
                console.error('Failed to create WebSocket connection:', error)
                set({
                    socket: null,
                    isConnected: false,
                    isConnecting: false,
                    connectionError: error instanceof Error ? error.message : 'Connection failed',
                })
            }
        },

        // Disconnect from WebSocket
        disconnect: () => {
            const state = get()
            console.log('Manually disconnecting WebSocket')

            if (state.socket) {
                state.socket.close(1000) // Normal closure
            }

            set({
                socket: null,
                isConnected: false,
                isConnecting: false,
                connectionError: null,
                reconnectCount: 0,
            })
        },

        // Send message through WebSocket
        sendMessage: (message: string) => {
            const state = get()

            if (state.socket?.readyState === WebSocket.OPEN) {
                console.log('Sending WebSocket message:', message)
                state.socket.send(message)
            } else {
                console.warn('Cannot send message: WebSocket is not connected')
            }
        },

        // Internal actions
        _setSocket: (socket: WebSocket | null) => {
            set({ socket })
        },

        _setConnectionState: (newState) => {
            set(newState)
        },

        _handleMessage: (message: ChatMessage) => {
            // This can be used for any additional message processing
            // For now, it's just a placeholder
            console.log('Handling message internally:', message.id)
        },
    }))
)

// Auto-cleanup on app state changes (React Native)
AppState.addEventListener('change', (nextAppState) => {
    const state = useWebSocketStore.getState()

    if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App is going to background or becoming inactive
        console.log('App going to background, maintaining WebSocket connection')
        // Note: We don't automatically disconnect here as users might want
        // to continue receiving messages in the background
    } else if (nextAppState === 'active') {
        // App is becoming active
        console.log('App becoming active')
        // Optionally reconnect if connection was lost
        if (
            !state.isConnected &&
            !state.isConnecting &&
            state.currentUserId &&
            state.currentUsername
        ) {
            console.log('Reconnecting WebSocket after app became active')
            state.connect(state.currentRoomId, state.currentUserId, state.currentUsername)
        }
    }
})
