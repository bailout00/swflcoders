import { View } from 'tamagui'
import { useUserStore } from '../../stores/userStore'
import UsernameInput from '../../components/UsernameInput'
import ChatInterface from '../../components/ChatInterface'

export default function ChatScreen() {
  const isUserReady = useUserStore((state) => state.isUserReady())
  
  console.log('ChatScreen render - isUserReady:', isUserReady)

  return (
    <View flex={1} bg="$background">
      {isUserReady ? (
        <ChatInterface />
      ) : (
        <UsernameInput />
      )}
    </View>
  )
}
