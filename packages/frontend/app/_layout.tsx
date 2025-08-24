import '../tamagui-web.css'

import {useEffect} from 'react'
import {useColorScheme} from 'react-native'
import {StatusBar} from 'expo-status-bar'
import {DarkTheme, DefaultTheme, ThemeProvider} from '@react-navigation/native'
import {useFonts} from 'expo-font'
import {SplashScreen, Stack} from 'expo-router'
import {Provider} from 'components/Provider'
import {useTheme, View} from 'tamagui'

export {ErrorBoundary,} from 'expo-router'

export const unstable_settings = {
    // Ensure that reloading on `/modal` keeps a back button present.
    initialRouteName: '(tabs)',
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
    console.log("test");
    const [interLoaded, interError] = useFonts({
        Inter: require('@tamagui/font-inter/otf/Inter-Medium.otf'),
        InterBold: require('@tamagui/font-inter/otf/Inter-Bold.otf'),
    })

    useEffect(() => {
        if (interLoaded || interError) {
            // Hide the splash screen after the fonts have loaded (or an error was returned) and the UI is ready.
            SplashScreen.hideAsync()
        }
    }, [interLoaded, interError])

    if (!interLoaded && !interError) {
        return null
    }

    return (
        <Providers>
            <RootLayoutNav/>
        </Providers>
    )
}

const Providers = ({children}: { children: React.ReactNode }) => {
    return <Provider>{children}</Provider>
}

function RootLayoutNav() {
    const colorScheme = useColorScheme()
    const theme = useTheme()
    return (
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'}/>
            <View flex={1} height="100%" backgroundColor={theme.background.val}>
                <Stack
                    screenOptions={{
                        contentStyle: {
                            backgroundColor: theme.background.val,
                            flex: 1,
                            height: '100%',
                        },
                    }}
                >
                    <Stack.Screen
                        name="(tabs)"
                        options={{
                            headerShown: false,
                            contentStyle: {
                                backgroundColor: theme.background.val,
                                flex: 1,
                                height: '100%',
                            },
                        }}
                    />

                    <Stack.Screen
                        name="modal"
                        options={{
                            title: 'Tamagui + Expo',
                            presentation: 'modal',
                            animation: 'slide_from_right',
                            gestureEnabled: true,
                            gestureDirection: 'horizontal',
                            contentStyle: {
                                backgroundColor: theme.background.val,
                                flex: 1,
                                height: '100%',
                            },
                        }}
                    />
                </Stack>
            </View>
        </ThemeProvider>
    )
}
