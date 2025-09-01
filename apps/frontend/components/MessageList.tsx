import { useEffect, useRef } from 'react'
import { ScrollView } from 'react-native'
import { YStack, Text } from 'tamagui'
import type { Message } from '../types/chat'
import MessageItem from './MessageItem'

interface MessageListProps {
    messages: Message[]
    isLoading?: boolean
}

export default function MessageList({ messages, isLoading }: MessageListProps) {
    const scrollViewRef = useRef<ScrollView>(null)

    useEffect(() => {
        // Auto-scroll to bottom when new messages arrive
        if (messages.length > 0) {
            setTimeout(() => {
                scrollViewRef.current?.scrollToEnd({ animated: true })
            }, 100)
        }
    }, [messages.length])

    if (isLoading) {
        return (
            <YStack flex={1} justifyContent="center" alignItems="center">
                <Text color="$color10">Loading messages...</Text>
            </YStack>
        )
    }

    if (messages.length === 0) {
        return (
            <YStack flex={1} justifyContent="center" alignItems="center" padding="$4">
                <Text color="$color10" textAlign="center" fontSize="$4">
                    No messages yet. Start the conversation!
                </Text>
            </YStack>
        )
    }

    return (
        <ScrollView
            ref={scrollViewRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingVertical: 8 }}
            keyboardShouldPersistTaps="handled"
        >
            <YStack gap="$1">
                {messages.map((message) => (
                    <MessageItem key={message.id} message={message} />
                ))}
            </YStack>
        </ScrollView>
    )
}
