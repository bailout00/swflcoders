export interface Message {
  id: string
  username: string
  text: string
  timestamp: Date
  isOwnMessage?: boolean
}

export interface SendMessageRequest {
  username: string
  text: string
}

export interface SendMessageResponse {
  success: boolean
  message?: Message
  error?: string
}
