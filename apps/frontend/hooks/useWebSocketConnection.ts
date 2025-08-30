import { useEffect } from 'react'
import { useUserStore } from '../stores/userStore'
import { useWebSocketStore, setGlobalMessageHandler } from '../stores/websocketStore'
import { useOptimisticMessage } from './useChatQueries'
import { DEFAULT_ROOM_ID } from '../config/api'

/**
 * Hook to manage WebSocket connection and integrate with chat queries
 * This should be used once at the app level to establish the connection
 */
export function useWebSocketConnection(roomId: string = DEFAULT_ROOM_ID) {
  const userId = useUserStore((state) => state.getUserId())
  const username = useUserStore((state) => state.username)
  
  const { connect, disconnect, isConnected, isConnecting, connectionError, reconnectCount } = useWebSocketStore()
  const { addMessage } = useOptimisticMessage(roomId)
  
  // Set up the global message handler to add messages to the query cache
  useEffect(() => {
    setGlobalMessageHandler((message) => {
      console.log('Adding WebSocket message to cache:', message)
      addMessage(message)
    })
    
    // Cleanup: remove the handler when component unmounts
    return () => {
      setGlobalMessageHandler(() => {})
    }
  }, [addMessage])
  
  // Auto-connect when user is ready
  useEffect(() => {
    if (userId && username && !isConnected && !isConnecting) {
      console.log('Auto-connecting WebSocket for user:', username)
      connect(roomId, userId, username)
    }
  }, [userId, username, roomId, isConnected, isConnecting, connect])
  
  // Disconnect on user change or component unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up WebSocket connection')
      disconnect()
    }
  }, [disconnect])
  
  // Return connection state for UI feedback
  return {
    isConnected,
    isConnecting,
    connectionError,
    reconnectCount,
    connect: (newRoomId?: string) => {
      if (userId && username) {
        connect(newRoomId || roomId, userId, username)
      }
    },
    disconnect,
  }
}
