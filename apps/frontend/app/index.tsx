import { Redirect, useNavigation } from 'expo-router'
import { useEffect } from 'react'

export default function Home() {
    const navigation = useNavigation()

    useEffect(() => {
        navigation.setOptions({ headerShown: false })
    }, [navigation])

    return <Redirect href="/(tabs)" /> // Redirects to the 'home' tab within the tabs layout
}
