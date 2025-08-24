export interface Message {
  id: string
  userId: string
  username: string
  text: string
  timestamp: Date
  isOwnMessage?: boolean
}

export interface SendMessageRequest {
  userId: string
  username: string
  text: string
}

export interface SendMessageResponse {
  success: boolean
  message?: Message
  error?: string
}
