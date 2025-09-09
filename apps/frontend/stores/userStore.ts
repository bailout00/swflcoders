import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import 'react-native-get-random-values'
import { ulid } from 'ulid'

interface UserState {
    userId: string | null
    username: string | null
    setUsername: (username: string) => void
    clearUser: () => void
    clearUsername: () => void // Backward compatibility
    isUsernameSet: () => boolean // Backward compatibility
    isUserReady: () => boolean
    getUserId: () => string | null
}

interface PersistedUserState {
    userId: string | null
    username: string | null
}

export const useUserStore = create<UserState>()(
    persist(
        (set, get) => ({
            userId: null,
            username: null,
            setUsername: (username: string) => {
                const state = get()
                const userId = state.userId || ulid()
                console.log('Setting username:', { username, userId })
                set({ username, userId })
            },
            clearUser: () => {
                console.log('Clearing user data')

                // Disconnect WebSocket when user logs out
                // Import needs to be dynamic to avoid circular dependency
                import('./websocketStore').then(({ useWebSocketStore }) => {
                    const { disconnect } = useWebSocketStore.getState()
                    disconnect()
                })

                set({ username: null, userId: null })
            },
            clearUsername: () => get().clearUser(), // Backward compatibility
            isUsernameSet: () => {
                const state = get()
                return state.username !== null && state.username !== ''
            },
            isUserReady: () => {
                const state = get()
                return !!(state.username && state.userId)
            },
            getUserId: () => {
                const userId = get().userId
                console.log('Getting user ID:', userId)
                return userId
            },
        }),
        {
            name: 'user-storage',
            storage: createJSONStorage(() => AsyncStorage),
            version: 2,
            migrate: (persistedState: any, version: number) => {
                console.log('Migrating user store from version', version, 'to version 2')
                if (version < 2) {
                    // Migration from version 1 or initial state
                    const oldState = persistedState as { username?: string | null }
                    const newState: PersistedUserState = {
                        username: oldState.username || null,
                        userId: oldState.username ? ulid() : null, // Generate userId if username exists
                    }
                    console.log('Migrated state:', newState)
                    return newState
                }
                return persistedState as PersistedUserState
            },
        }
    )
)
