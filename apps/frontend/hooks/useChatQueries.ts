import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchMessages, sendMessage } from '../api/chatApi'
import type { Message, SendMessageRequestUI } from '../types/chat'
import { useUserStore } from '../stores/userStore'
import { DEFAULT_ROOM_ID } from '../config/api'
import { ulid } from 'ulid'

// Query keys
export const chatQueryKeys = {
    messages: (roomId: string = DEFAULT_ROOM_ID) => ['messages', roomId] as const,
}

// Utility function to merge messages by ID, preferring latest version
// Handles both server IDs and clientMessageIds for proper deduplication
function mergeMessagesById(existing: Message[], incoming: Message[]): Message[] {
    const messageMap = new Map<string, Message>()
    const clientMessageIdMap = new Map<string, string>() // clientMessageId -> id mapping

    // Add existing messages and track clientMessageId mappings
    existing.forEach((msg) => {
        messageMap.set(msg.id, msg)
        if (msg.clientMessageId) {
            clientMessageIdMap.set(msg.clientMessageId, msg.id)
        }
    })

    // Add/overwrite with incoming messages, handling clientMessageId deduplication
    incoming.forEach((msg) => {
        // If this message has a clientMessageId and we already have a message with that clientMessageId,
        // remove the old optimistic message first
        if (msg.clientMessageId && clientMessageIdMap.has(msg.clientMessageId)) {
            const existingId = clientMessageIdMap.get(msg.clientMessageId)!
            messageMap.delete(existingId)
            clientMessageIdMap.delete(msg.clientMessageId)
        }

        // Add the new message, preserving ownership if it exists
        // If we're replacing an existing message, preserve the isOwnMessage property
        if (messageMap.has(msg.id)) {
            const existingMsg = messageMap.get(msg.id)!
            messageMap.set(msg.id, {
                ...msg,
                isOwnMessage:
                    msg.isOwnMessage !== undefined ? msg.isOwnMessage : existingMsg.isOwnMessage,
            })
        } else {
            messageMap.set(msg.id, msg)
        }

        if (msg.clientMessageId) {
            clientMessageIdMap.set(msg.clientMessageId, msg.id)
        }
    })

    // Convert back to array and sort by timestamp (oldest first, newest last)
    return Array.from(messageMap.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
}

// Utility to add ownership to messages based on current userId
function addOwnership(messages: Message[], currentUserId: string | null): Message[] {
    return messages.map((msg) => {
        // Preserve existing isOwnMessage if it's already set correctly
        if (msg.isOwnMessage !== undefined) {
            return msg
        }

        // Otherwise, determine ownership based on userId comparison
        const isOwn = currentUserId ? msg.userId === currentUserId : false

        // Debug logging to understand ownership issues
        if (currentUserId && msg.userId) {
            console.log('Ownership check:', {
                messageId: msg.id,
                messageUserId: msg.userId,
                currentUserId,
                isOwn,
                hasClientMessageId: !!msg.clientMessageId,
            })
        }

        return {
            ...msg,
            isOwnMessage: isOwn,
        }
    })
}

// Hook to fetch messages for a specific room
export function useMessages(roomId: string = DEFAULT_ROOM_ID) {
    const currentUserId = useUserStore((state) => state.getUserId())

    return useQuery({
        queryKey: chatQueryKeys.messages(roomId),
        queryFn: () => fetchMessages(roomId, currentUserId || undefined),
        staleTime: 1000 * 60, // Consider data stale after 1 minute (since we have real-time updates)
        select: (messages: Message[]) => {
            // Add ownership information to all messages
            return addOwnership(messages, currentUserId)
        },
    })
}

// Hook to send messages with optimistic updates
export function useSendMessage(roomId: string = DEFAULT_ROOM_ID) {
    const queryClient = useQueryClient()
    const username = useUserStore((state) => state.username)
    const currentUserId = useUserStore((state) => state.getUserId())

    return useMutation({
        mutationFn: (text: string) => {
            if (!username || !currentUserId) {
                throw new Error('Username and userId are required to send messages')
            }

            // Generate a client message ID for deduplication
            const clientMessageId = ulid()

            const request: SendMessageRequestUI = {
                roomId,
                userId: currentUserId,
                username,
                text,
                clientMessageId,
            }

            // Optimistically add message to cache before sending
            const optimisticMessage: Message = {
                id: clientMessageId, // Use clientMessageId as temporary ID
                room_id: roomId,
                userId: currentUserId,
                username,
                text,
                timestamp: new Date(),
                isOwnMessage: true,
                clientMessageId,
            }

            console.log('Creating optimistic message:', {
                id: optimisticMessage.id,
                userId: optimisticMessage.userId,
                username: optimisticMessage.username,
                currentUserId,
                isOwnMessage: optimisticMessage.isOwnMessage,
            })

            queryClient.setQueryData(chatQueryKeys.messages(roomId), (old: Message[] = []) => {
                const updatedMessages = mergeMessagesById(old, [optimisticMessage])
                return addOwnership(updatedMessages, currentUserId)
            })

            return sendMessage(request)
        },
        onSuccess: (response, text) => {
            if (response.success && response.message) {
                // Replace optimistic message with real message from server
                queryClient.setQueryData(chatQueryKeys.messages(roomId), (old: Message[] = []) => {
                    const updatedMessages = mergeMessagesById(old, [response.message!])
                    return addOwnership(updatedMessages, currentUserId)
                })
            }
        },
        onError: (error, text) => {
            console.error('Failed to send message:', error)
            // Remove optimistic message on error
            queryClient.setQueryData(chatQueryKeys.messages(roomId), (old: Message[] = []) => {
                // Remove failed message by checking for optimistic messages (those with clientMessageId)
                const filteredMessages = old.filter(
                    (msg) => !(msg.isOwnMessage && msg.text === text && msg.clientMessageId)
                )
                return addOwnership(filteredMessages, currentUserId)
            })
            // You could add toast notifications here
        },
    })
}

// Hook to add real-time messages from WebSocket
export function useOptimisticMessage(roomId: string = DEFAULT_ROOM_ID) {
    const queryClient = useQueryClient()
    const currentUserId = useUserStore((state) => state.getUserId())

    const addMessage = (message: Message) => {
        console.log('Adding WebSocket message:', {
            messageId: message.id,
            messageUserId: message.userId,
            currentUserId,
            hasClientMessageId: !!message.clientMessageId,
            isOwnMessage: message.isOwnMessage,
        })

        queryClient.setQueryData(chatQueryKeys.messages(roomId), (old: Message[] = []) => {
            // Deduplicate and add ownership information
            const updatedMessages = mergeMessagesById(old, [message])
            return addOwnership(updatedMessages, currentUserId)
        })
    }

    return { addMessage }
}
