import { YStack, XStack, Button, SizableText } from 'tamagui'
import { CheckCircle, LogOut, MessageCircleWarning, MessageCircleX } from '@tamagui/lucide-icons'
import { useUserStore } from '../stores/userStore'
import { useMessages, useSendMessage } from '../hooks/useChatQueries'
import { useWebSocketConnection } from '../hooks/useWebSocketConnection'
import { DEFAULT_ROOM_ID } from '../config/api'
import MessageList from './MessageList'
import MessageInput from './MessageInput'

export default function ChatInterface() {
    const username = useUserStore((state) => state.username)
    const clearUser = useUserStore((state) => state.clearUser)
    const { data: messages = [], isLoading, error, refetch } = useMessages(DEFAULT_ROOM_ID)
    const sendMessageMutation = useSendMessage(DEFAULT_ROOM_ID)

    // WebSocket connection for real-time updates (using Zustand store)
    const {
        isConnected: wsConnected,
        isConnecting: wsConnecting,
        connectionError: wsError,
        reconnectCount,
    } = useWebSocketConnection(DEFAULT_ROOM_ID)

    // Removed excessive logging that was making it appear like constant re-renders

    const handleSendMessage = (text: string) => {
        sendMessageMutation.mutate(text)
    }

    const handleLogout = () => {
        console.log('Logging out user')
        clearUser()
    }

    if (error) {
        return (
            <YStack justifyContent="center" alignItems="center" padding="$4">
                <SizableText color="$red10" textAlign="center" marginBottom="$4" bg={'red'}>
                    Failed to load messages. Please try again.
                </SizableText>
                <Button onPress={() => refetch()}>Retry</Button>
            </YStack>
        )
    }

    return (
        <YStack flex={1} bg={'$background'} width={'100%'} maxWidth={800}>
            {/* Header */}
            <XStack
                p="$3"
                bg="$shadowColor"
                borderBottomWidth={1}
                borderBottomColor="$borderColor"
                justifyContent="space-between"
                alignItems="center"
            >
                <SizableText fontSize="$5" fontWeight="600" color="$color">
                    Chat
                </SizableText>
                <XStack alignItems="center" gap="$4">
                    {/* WebSocket Connection Status */}
                    <XStack alignItems="center" gap="$4">
                        {wsConnected ? (
                            <CheckCircle size="$1" color="$green10" />
                        ) : wsConnecting ? (
                            <MessageCircleWarning size="$1" color="$yellow10" />
                        ) : (
                            <MessageCircleX size="$1" color="$red10" />
                        )}
                        <SizableText fontSize="$2">
                            {wsConnected
                                ? 'Connected'
                                : wsConnecting
                                  ? 'Connecting'
                                  : 'Disconnected'}
                        </SizableText>
                        {reconnectCount > 0 && (
                            <SizableText fontSize="$2">
                                {wsConnected
                                    ? 'Connected'
                                    : wsConnecting
                                      ? 'Connecting'
                                      : 'Disconnected'}
                            </SizableText>
                        )}
                    </XStack>

                    <SizableText fontSize="$3">{username}</SizableText>
                    <Button
                        testID="logout-button"
                        size="$2"
                        variant="outlined"
                        onPress={handleLogout}
                        icon={<LogOut size="$1" />}
                    >
                        Logout
                    </Button>
                </XStack>
            </XStack>

            {/* WebSocket Error Notification */}
            {wsError && !wsConnected && (
                <XStack
                    padding="$2"
                    backgroundColor="$red2"
                    borderBottomWidth={1}
                    borderBottomColor="$red6"
                    justifyContent="center"
                    alignItems="center"
                >
                    <SizableText fontSize="$2" color="$red11" textAlign="center">
                        Real-time updates unavailable: {wsError}
                        {reconnectCount > 0 && ` (Reconnecting...)`}
                    </SizableText>
                </XStack>
            )}

            {/* Messages */}
            <YStack flex={1}>
                <MessageList messages={messages} isLoading={isLoading} />
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
