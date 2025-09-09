import { View } from 'tamagui'
import ChatInterface from '../../components/ChatInterface'
import UsernameInput from '../../components/UsernameInput'
import { useUserStore } from '../../stores/userStore'

export default function TabTwoScreen() {
    const isUserReady = useUserStore((state) => state.isUserReady())
    console.log('ChatScreen render - isUserReady:', isUserReady)

    return (
        <View flex={1} items="center" justify="center" bg="$background">
            {isUserReady ? <ChatInterface /> : <UsernameInput />}
        </View>
    )
}
