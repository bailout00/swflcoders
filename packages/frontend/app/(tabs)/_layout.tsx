import { Link, Tabs } from 'expo-router'
import { Button, useTheme, View } from 'tamagui'
import { Atom, AudioWaveform } from '@tamagui/lucide-icons'

export default function TabLayout() {
  const theme = useTheme()

  return (
    <View flex={1} backgroundColor={theme.background.val}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.red10.val,
          tabBarStyle: {
            backgroundColor: theme.background.val,
            borderTopColor: theme.borderColor.val,
          },
          headerStyle: {
            backgroundColor: theme.background.val,
            borderBottomColor: theme.borderColor.val,
          },
          headerTintColor: theme.color.val,
          sceneContainerStyle: {
            backgroundColor: theme.background.val,
            flex: 1,
          },
        }}
      >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Atom color={color as any} />,
          headerRight: () => (
            <Link href="/modal" asChild>
              <Button mr="$4" size="$2.5">
                Hello!
              </Button>
            </Link>
          ),
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <AudioWaveform color={color as any} />,
        }}
      />
      </Tabs>
    </View>
  )
}
