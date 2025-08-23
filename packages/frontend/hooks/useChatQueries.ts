import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchMessages, sendMessage } from '../api/chatApi'
import { Message, SendMessageRequest } from '../types/chat'
import { useUserStore } from '../stores/userStore'

// Query keys
export const chatQueryKeys = {
  messages: ['messages'] as const,
}

// Hook to fetch messages
export function useMessages() {
  return useQuery({
    queryKey: chatQueryKeys.messages,
    queryFn: fetchMessages,
    refetchInterval: 3000, // Refetch every 3 seconds to simulate real-time updates
    staleTime: 1000, // Consider data stale after 1 second
  })
}

// Hook to send messages
export function useSendMessage() {
  const queryClient = useQueryClient()
  const username = useUserStore((state) => state.username)

  return useMutation({
    mutationFn: (text: string) => {
      if (!username) {
        throw new Error('Username is required to send messages')
      }
      return sendMessage({ username, text })
    },
    onSuccess: (response) => {
      if (response.success && response.message) {
        // Optimistically update the query cache
        queryClient.setQueryData(chatQueryKeys.messages, (old: Message[] = []) => {
          // Check if message already exists to avoid duplicates
          const exists = old.some(msg => msg.id === response.message!.id)
          if (!exists) {
            return [...old, response.message!]
          }
          return old
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
  const username = useUserStore((state) => state.username)

  const addMessage = (message: Message) => {
    queryClient.setQueryData(chatQueryKeys.messages, (old: Message[] = []) => {
      // Mark message as own if it's from the current user
      const messageWithOwnership = {
        ...message,
        isOwnMessage: message.username === username,
      }
      
      // Check if message already exists to avoid duplicates
      const exists = old.some(msg => msg.id === message.id)
      if (!exists) {
        return [...old, messageWithOwnership]
      }
      return old
    })
  }

  return { addMessage }
}
