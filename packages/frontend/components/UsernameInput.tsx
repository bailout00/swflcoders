import { useState } from 'react'
import { Button, Input, YStack, Text, H3 } from 'tamagui'
import { useUserStore } from '../stores/userStore'

export default function UsernameInput() {
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState('')
  const setUsername = useUserStore((state) => state.setUsername)

  const handleSubmit = () => {
    if (!inputValue.trim()) {
      setError('Please enter a username')
      return
    }

    if (inputValue.trim().length < 2) {
      setError('Username must be at least 2 characters long')
      return
    }

    setError('')
    setUsername(inputValue.trim())
    // The parent component will automatically re-render when the username changes
    // due to Zustand's reactivity, so no callback is needed
  }

  return (
    <YStack gap="$4" p="$4" items="center" justify="center" flex={1}>
      <H3 textAlign="center" color="$color">
        Welcome to Chat!
      </H3>
      <Text textAlign="center" color="$gray10" fontSize="$4">
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
        />
        {error && (
          <Text color="$red10" fontSize="$3" textAlign="center">
            {error}
          </Text>
        )}
        <Button 
          onPress={handleSubmit}
          disabled={!inputValue.trim()}
          backgroundColor="$blue10"
          color="white"
        >
          Set Username
        </Button>
      </YStack>
    </YStack>
  )
}
