import { useState } from 'react'
import { Button, Input, XStack } from 'tamagui'
import { Send } from '@tamagui/lucide-icons'

interface MessageInputProps {
    onSendMessage: (text: string) => void
    isLoading?: boolean
    disabled?: boolean
}

export default function MessageInput({
    onSendMessage,
    isLoading = false,
    disabled = false,
}: MessageInputProps) {
    const [message, setMessage] = useState('')

    const handleSend = () => {
        const trimmedMessage = message.trim()
        if (trimmedMessage && !isLoading && !disabled) {
            onSendMessage(trimmedMessage)
            setMessage('')
        }
    }

    const handleSubmit = () => {
        handleSend()
    }

    return (
        <XStack
            padding="$3"
            gap="$2"
            backgroundColor="$background"
            borderTopWidth={1}
            borderTopColor="$borderColor"
            alignItems="flex-end"
        >
            <Input
                testID="message-input"
                flex={1}
                placeholder="Type a message..."
                value={message}
                onChangeText={setMessage}
                onSubmitEditing={handleSubmit}
                disabled={disabled || isLoading}
                multiline
                maxLength={1000}
                textAlignVertical="top"
                minHeight={40}
                maxHeight={120}
            />
            <Button
                testID="send-message-button"
                size="$3"
                circular
                backgroundColor="$blue10"
                color="white"
                onPress={handleSend}
                disabled={!message.trim() || isLoading || disabled}
                opacity={!message.trim() || isLoading || disabled ? 0.5 : 1}
                icon={<Send size="$1" />}
            />
        </XStack>
    )
}
