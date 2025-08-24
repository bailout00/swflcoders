import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchMessages, sendMessage } from '../api/chatApi'
import { Message, SendMessageRequest } from '../types/chat'
import { useUserStore } from '../stores/userStore'

// Query keys
export const chatQueryKeys = {
  messages: ['messages'] as const,
}

// Utility function to merge messages by ID, preferring latest version
function mergeMessagesById(existing: Message[], incoming: Message[]): Message[] {
  const messageMap = new Map<string, Message>()
  
  // Add existing messages
  existing.forEach(msg => messageMap.set(msg.id, msg))
  
  // Add/overwrite with incoming messages
  incoming.forEach(msg => messageMap.set(msg.id, msg))
  
  // Convert back to array and sort by timestamp
  return Array.from(messageMap.values()).sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
}

// Utility to add ownership to messages based on current userId
function addOwnership(messages: Message[], currentUserId: string | null): Message[] {
  return messages.map(msg => ({
    ...msg,
    isOwnMessage: currentUserId ? msg.userId === currentUserId : false,
  }))
}

// Hook to fetch messages
export function useMessages() {
  const currentUserId = useUserStore((state) => state.getUserId())
  
  return useQuery({
    queryKey: chatQueryKeys.messages,
    queryFn: fetchMessages,
    refetchInterval: 3000, // Refetch every 3 seconds to simulate real-time updates
    staleTime: 1000, // Consider data stale after 1 second
    select: (messages: Message[]) => {
      // Add ownership information to all messages
      return addOwnership(messages, currentUserId)
    },
  })
}

// Hook to send messages
export function useSendMessage() {
  const queryClient = useQueryClient()
  const username = useUserStore((state) => state.username)
  const userId = useUserStore((state) => state.getUserId())
  const currentUserId = useUserStore((state) => state.getUserId())

  return useMutation({
    mutationFn: (text: string) => {
      if (!username || !userId) {
        throw new Error('Username and userId are required to send messages')
      }
      return sendMessage({ userId, username, text })
    },
    onSuccess: (response) => {
      if (response.success && response.message) {
        // Optimistically update the query cache with deduplication
        queryClient.setQueryData(chatQueryKeys.messages, (old: Message[] = []) => {
          const updatedMessages = mergeMessagesById(old, [response.message!])
          return addOwnership(updatedMessages, currentUserId)
        })
      }
    },
    onError: (error) => {
      console.error('Failed to send message:', error)
      // You could add toast notifications here
    },
  })
}

// Hook to add optimistic updates for real-time messages
export function useOptimisticMessage() {
  const queryClient = useQueryClient()
  const currentUserId = useUserStore((state) => state.getUserId())

  const addMessage = (message: Message) => {
    queryClient.setQueryData(chatQueryKeys.messages, (old: Message[] = []) => {
      // Deduplicate and add ownership information
      const updatedMessages = mergeMessagesById(old, [message])
      return addOwnership(updatedMessages, currentUserId)
    })
  }

  return { addMessage }
}
