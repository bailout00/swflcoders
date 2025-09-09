import { useState } from 'react'
import { Button, Input, YStack, Text, H3 } from 'tamagui'
import { useUserStore } from '../stores/userStore'

export default function UsernameInput() {
    console.log('test')
    const [inputValue, setInputValue] = useState('')
    const [error, setError] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const setUsername = useUserStore((state) => state.setUsername)

    const handleSubmit = () => {
        console.log('🔘 Button clicked! handleSubmit called with input:', inputValue.trim())

        if (isLoading) {
            console.log('Already submitting, ignoring')
            return
        }

        const trimmedInput = inputValue.trim()

        if (!trimmedInput) {
            console.log('❌ No input provided')
            setError('Please enter a username')
            return
        }

        if (trimmedInput.length < 2) {
            console.log('❌ Input too short')
            setError('Username must be at least 2 characters long')
            return
        }

        setIsLoading(true)
        setError('')

        try {
            console.log('✅ Setting username:', trimmedInput)
            setUsername(trimmedInput)
            console.log('✅ Username set successfully')
        } catch (err) {
            console.error('❌ Error setting username:', err)
            setError('Failed to set username. Please try again.')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <YStack gap="$4" p="$4" items="center" justify="center" flex={1} width={'100%'} mx={0}>
            <H3 textAlign="center" color="$color">
                Welcome to Chat!
            </H3>
            <Text textAlign="center" color="$color10" fontSize="$4">
                Please enter your name to start chatting
            </Text>

            <YStack gap="$2" width="80%" maxWidth={300}>
                <Input
                    placeholder="Enter your name"
                    value={inputValue}
                    onChangeText={setInputValue}
                    onSubmitEditing={handleSubmit}
                    autoFocus
                    borderColor={error ? '$red8' : '$borderColor'}
                    testID="username-input"
                />
                {error && (
                    <Text color="$red10" fontSize="$3" textAlign="center">
                        {error}
                    </Text>
                )}
                <Button
                    onPress={() => {
                        console.log('🔘 Button onPress triggered!')
                        handleSubmit()
                    }}
                    disabled={isLoading}
                    backgroundColor={isLoading ? '$gray8' : '$blue10'}
                    color="white"
                    size="$4"
                    pressStyle={{ scale: 0.97 }}
                    testID="username-submit-button"
                    cursor="pointer"
                >
                    {isLoading ? 'Setting...' : 'Set Username'}
                </Button>
            </YStack>
        </YStack>
    )
}
