import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface UserState {
  username: string | null
  setUsername: (username: string) => void
  clearUsername: () => void
  isUsernameSet: () => boolean
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      username: null,
      setUsername: (username: string) => set({ username }),
      clearUsername: () => set({ username: null }),
      isUsernameSet: () => get().username !== null && get().username !== '',
    }),
    {
      name: 'user-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
