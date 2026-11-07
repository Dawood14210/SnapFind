import { isApiError } from '@/api'

/** Contract error codes -> friendly one-line messages for the UI. */
const MESSAGES: Record<string, string> = {
  ROOM_FULL: 'Room is full (25 players max).',
  ROOM_NOT_FOUND: 'No room with that code.',
  ROOM_NOT_LOBBY: 'This room already started — ask for a new code.',
  NICKNAME_DUPLICATE: 'That nickname is taken in this room.',
  NICKNAME_INVALID: 'Nickname must be 1–20 characters.',
  ALREADY_IN_ROOM: 'You are already in a room — leave it first.',
  NOT_IN_ROOM: 'You are not in this room.',
  NOT_HOST: 'Only the host can do that.',
  CANNOT_KICK_HOST: 'The host cannot be kicked.',
  PLAYER_NOT_FOUND: 'That player is not in the room.',
  ROUND_ACTIVE: 'The round already started.',
  NO_PLAY_AREA: 'Set a play area before starting the round.',
  NOT_ALL_READY: 'Waiting for all players to be ready.',
  MIN_PLAYERS: 'Need at least 4 players to start.',
  NOT_ACTIVE: 'The round is not active.',
  NOT_PAUSED: 'The round is not paused.',
  INVALID_RADIUS: 'Play area radius must be 100–600 m.',
  INVALID_COORDS: 'Invalid map coordinates.',
  FINDER_NOT_IN_ROOM: 'That player is not in the room.',
}

export function friendlyError(err: unknown): string {
  if (isApiError(err)) {
    return MESSAGES[err.code] ?? err.message
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}
