import { ulid } from 'ulid'
import { Message, SendMessageRequest, SendMessageResponse } from '../types/chat'

// Constants for system users
const SYSTEM_USER_ID = 'SYSTEM'
const DEMO_USER_ID = 'DEMO_USER'
const RANDOM_USER_ID = 'RANDOM_USER'

// Mock data store for demo purposes
let mockMessages: Message[] = [
  {
    id: ulid(),
    userId: SYSTEM_USER_ID,
    username: 'System',
    text: 'Welcome to the chat! This is a demo message.',
    timestamp: new Date(Date.now() - 30000),
    isOwnMessage: false,
  }
]

// Simulate API delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Pseudo API function to fetch messages
export async function fetchMessages(): Promise<Message[]> {
  await delay(500) // Simulate network delay
  
  // In a real app, this would make an HTTP request to your backend
  console.log('Fetching messages from API...')
  
  return mockMessages.map(msg => ({
    ...msg,
    timestamp: new Date(msg.timestamp)
  }))
}

// Pseudo API function to send a message
export async function sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
  await delay(300) // Simulate network delay
  
  // In a real app, this would make an HTTP POST request to your backend
  console.log('Sending message to API:', request)
  
  // Simulate successful message sending
  const newMessage: Message = {
    id: ulid(),
    userId: request.userId,
    username: request.username,
    text: request.text,
    timestamp: new Date(),
    // Don't set isOwnMessage here - let the client determine ownership
  }
  
  // Add to mock store
  mockMessages.push(newMessage)
  
  // Simulate a response from another user after a delay
  setTimeout(() => {
    const responseMessage: Message = {
      id: ulid(),
      userId: DEMO_USER_ID,
      username: 'Demo User',
      text: `Thanks for your message: "${request.text}"`,
      timestamp: new Date(),
      isOwnMessage: false,
    }
    mockMessages.push(responseMessage)
  }, 2000)
  
  return {
    success: true,
    message: newMessage,
  }
}

// Pseudo API function to simulate real-time message updates
export async function subscribeToMessages(callback: (message: Message) => void) {
  // In a real app, this would establish a WebSocket connection
  console.log('Subscribing to real-time messages...')
  
  // Simulate periodic new messages
  const interval = setInterval(() => {
    if (Math.random() > 0.8) { // 20% chance every 5 seconds
      const randomMessage: Message = {
        id: ulid(),
        userId: RANDOM_USER_ID,
        username: 'Random User',
        text: `Random message at ${new Date().toLocaleTimeString()}`,
        timestamp: new Date(),
        isOwnMessage: false,
      }
      mockMessages.push(randomMessage)
      callback(randomMessage)
    }
  }, 5000)
  
  // Return cleanup function
  return () => clearInterval(interval)
}
