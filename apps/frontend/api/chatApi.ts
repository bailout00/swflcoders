import {
    type Message,
    type SendMessageRequestUI,
    type SendMessageResponse,
    type ChatMessage,
    type GetMessagesResponse,
    chatMessageToMessage,
    sendMessageRequestToBackend,
} from '../types/chat'
import { getRestUrl, DEFAULT_ROOM_ID } from '../config/api'

/**
 * Fetch messages for a specific room from the backend
 */
export async function fetchMessages(
    roomId: string = DEFAULT_ROOM_ID,
    currentUserId?: string
): Promise<Message[]> {
    console.log('Fetching messages from API for room:', roomId)

    try {
        const url = `${getRestUrl('messages')}/${roomId}`
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        if (!response.ok) {
            throw new Error(`Failed to fetch messages: ${response.status} ${response.statusText}`)
        }

        const data: GetMessagesResponse = await response.json()

        // Convert backend ChatMessages to frontend Messages
        return data.messages.map((chatMessage) => chatMessageToMessage(chatMessage, currentUserId))
    } catch (error) {
        console.error('Error fetching messages:', error)
        throw error
    }
}

/**
 * Send a message to the backend
 */
export async function sendMessage(request: SendMessageRequestUI): Promise<SendMessageResponse> {
    console.log('Sending message to API:', request)

    try {
        // Convert UI request to backend format
        const backendRequest = sendMessageRequestToBackend(request)

        const response = await fetch(getRestUrl('messages'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(backendRequest),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(
                `Failed to send message: ${response.status} ${response.statusText} - ${errorText}`
            )
        }

        const chatMessage: ChatMessage = await response.json()

        // Convert backend response to frontend format
        const message = chatMessageToMessage(chatMessage, request.userId)

        return {
            success: true,
            message,
        }
    } catch (error) {
        console.error('Error sending message:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        }
    }
}

/**
 * Check if the API is healthy
 */
export async function checkApiHealth(): Promise<boolean> {
    try {
        const response = await fetch(getRestUrl('health'), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        return response.ok
    } catch (error) {
        console.error('API health check failed:', error)
        return false
    }
}

// Deprecated function - kept for backward compatibility during migration
// Use WebSocket hook instead for real-time updates
export async function subscribeToMessages(callback: (message: Message) => void) {
    console.warn('subscribeToMessages is deprecated - use useChatSocket hook instead')

    // Return empty cleanup function
    return () => {}
}
