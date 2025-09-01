// Import shared types from backend
import type { ChatMessage as BackendChatMessage } from '../../../packages/types/bindings/ChatMessage'
import type { SendMessageRequest as BackendSendMessageRequest } from '../../../packages/types/bindings/SendMessageRequest'
import type { GetMessagesResponse } from '../../../packages/types/bindings/GetMessagesResponse'

// Frontend-specific message type that extends backend type with UI properties
export interface Message extends Omit<BackendChatMessage, 'created_at' | 'message_text'> {
    text: string // Rename message_text to text for UI consistency
    timestamp: Date // Convert created_at string to Date object
    isOwnMessage?: boolean // UI-only property for styling
}

// Re-export backend types for convenience
export type {
    BackendChatMessage as ChatMessage,
    BackendSendMessageRequest as SendMessageRequest,
    GetMessagesResponse,
}

// Frontend-specific request type
export interface SendMessageRequestUI {
    roomId: string
    userId: string
    username: string
    text: string
    clientMessageId?: string
}

// Frontend-specific response type
export interface SendMessageResponse {
    success: boolean
    message?: Message
    error?: string
}

// Helper function to convert backend ChatMessage to frontend Message
export function chatMessageToMessage(
    chatMessage: BackendChatMessage,
    currentUserId?: string
): Message {
    const isOwn = currentUserId ? chatMessage.userId === currentUserId : undefined

    console.log('Converting backend message to frontend:', {
        backendUserId: chatMessage.userId,
        currentUserId,
        isOwn,
        messageId: chatMessage.id,
        hasClientMessageId: !!chatMessage.clientMessageId,
    })

    return {
        ...chatMessage,
        text: chatMessage.message_text,
        timestamp: new Date(chatMessage.created_at),
        isOwnMessage: isOwn,
    }
}

// Helper function to convert frontend SendMessageRequestUI to backend SendMessageRequest
export function sendMessageRequestToBackend(
    request: SendMessageRequestUI
): BackendSendMessageRequest {
    return {
        room_id: request.roomId,
        user_id: request.userId, // Fix: use snake_case to match backend expectation
        username: request.username,
        message_text: request.text,
        client_message_id: request.clientMessageId || null, // Fix: use snake_case
    }
}
