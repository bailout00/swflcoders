import { Text, XStack, YStack } from 'tamagui'
import type { Message } from '../types/chat'

interface MessageItemProps {
    message: Message
}

export default function MessageItem({ message }: MessageItemProps) {
    const isOwnMessage = message.isOwnMessage

    return (
        <XStack
            justifyContent={isOwnMessage ? 'flex-end' : 'flex-start'}
            marginBottom="$2"
            paddingHorizontal="$3"
        >
            <YStack
                backgroundColor={isOwnMessage ? '$blue10' : '$blue2'}
                padding="$3"
                borderRadius="$4"
                maxWidth="70%"
                borderTopRightRadius={isOwnMessage ? '$1' : '$4'}
                borderTopLeftRadius={isOwnMessage ? '$4' : '$1'}
            >
                {!isOwnMessage && (
                    <Text fontSize="$2" fontWeight="600" marginBottom="$1">
                        {message.username}
                    </Text>
                )}
                <Text color={isOwnMessage ? 'white' : '$color'} fontSize="$4" lineHeight="$1">
                    {message.text}
                </Text>
                <Text
                    fontSize="$1"
                    color={isOwnMessage ? '$color3' : '$color10'}
                    marginTop="$1"
                    textAlign={isOwnMessage ? 'right' : 'left'}
                >
                    {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                    })}
                </Text>
            </YStack>
        </XStack>
    )
}
