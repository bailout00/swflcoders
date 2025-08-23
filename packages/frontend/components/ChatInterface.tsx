import { useEffect } from 'react'
import { YStack, XStack, Text, Button } from 'tamagui'
import { LogOut } from '@tamagui/lucide-icons'
import { useUserStore } from '../stores/userStore'
import { useMessages, useSendMessage } from '../hooks/useChatQueries'
import MessageList from './MessageList'
import MessageInput from './MessageInput'
import { Message } from '../types/chat'

export default function ChatInterface() {
  const { username, clearUsername } = useUserStore()
  const { data: messages = [], isLoading, error } = useMessages()
  const sendMessageMutation = useSendMessage()

  // Mark messages as own messages based on current username
  const messagesWithOwnership: Message[] = messages.map(message => ({
    ...message,
    isOwnMessage: message.username === username,
  }))

  const handleSendMessage = (text: string) => {
    sendMessageMutation.mutate(text)
  }

  const handleLogout = () => {
    clearUsername()
  }

  if (error) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$4">
        <Text color="$red10" textAlign="center" marginBottom="$4">
          Failed to load messages. Please try again.
        </Text>
        <Button onPress={() => window.location.reload()}>
          Retry
        </Button>
      </YStack>
    )
  }

  return (
    <YStack flex={1} backgroundColor="$background">
      {/* Header */}
      <XStack
        padding="$3"
        backgroundColor="$gray2"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        justifyContent="space-between"
        alignItems="center"
      >
        <Text fontSize="$5" fontWeight="600" color="$color">
          Chat
        </Text>
        <XStack alignItems="center" gap="$2">
          <Text fontSize="$3" color="$gray11">
            {username}
          </Text>
          <Button
            size="$2"
            variant="outlined"
            onPress={handleLogout}
            icon={<LogOut size="$1" />}
          >
            Logout
          </Button>
        </XStack>
      </XStack>

      {/* Messages */}
      <YStack flex={1}>
        <MessageList messages={messagesWithOwnership} isLoading={isLoading} />
      </YStack>

      {/* Input */}
      <MessageInput
        onSendMessage={handleSendMessage}
        isLoading={sendMessageMutation.isPending}
        disabled={!username}
      />
    </YStack>
  )
}
