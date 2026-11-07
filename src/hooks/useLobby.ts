import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/api/client'
import type { PlayerView, RoomView } from '@/api'

type Channel = ReturnType<SupabaseClient['channel']>

export interface LobbyState {
  room: RoomView | null
  players: PlayerView[]
  loading: boolean
  error: string | null
}

/**
 * Lobby state for a room code: initial load + live updates.
 *
 * The room and players are read through RLS (members can select their own
 * room). Live updates come from Realtime subscriptions on rooms and players
 * filtered by this room (the corrected RLS model makes them read-only, so
 * subscriptions only deliver changes the caller may see).
 */
export function useLobby(code: string) {
  const [state, setState] = useState<LobbyState>({
    room: null,
    players: [],
    loading: true,
    error: null,
  })

  const reload = useCallback(async (): Promise<RoomView | null> => {
    const supabase = getSupabase()
    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .maybeSingle()
    if (!roomData) {
      setState({ room: null, players: [], loading: false, error: 'You are not in this room.' })
      return null
    }
    const { data: playerData } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomData.id)
    setState({ room: roomData, players: playerData ?? [], loading: false, error: null })
    return roomData
  }, [code])

  useEffect(() => {
    let roomsChannel: Channel | null = null
    let playersChannel: Channel | null = null
    let cancelled = false

    const setup = async () => {
      const supabase = getSupabase()
      const room = await reload()
      if (cancelled || !room) return

      roomsChannel = supabase
        .channel(`rooms:${code}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
          () => reload(),
        )
        .subscribe()

      playersChannel = supabase
        .channel(`players:${room.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'players',
            filter: `room_id=eq.${room.id}`,
          },
          () => reload(),
        )
        .subscribe()
    }

    setup()

    return () => {
      cancelled = true
      if (roomsChannel) getSupabase().removeChannel(roomsChannel)
      if (playersChannel) getSupabase().removeChannel(playersChannel)
    }
  }, [code, reload])

  return { ...state, reload }
}
