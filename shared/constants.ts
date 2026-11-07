/**
 * Snapfind — shared game constants.
 *
 * Every game number lives here. Agent A (backend) owns this file.
 * Agent B (frontend) imports it and must never edit it.
 * The values in this file are the single source of truth for both agents
 * and for the API contract (/docs/api-contract.md).
 */

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

/** Uppercase alphabet for room codes: no O, I, L (avoid confusion with 0/1). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'
export const CODE_LENGTH = 6

// ---------------------------------------------------------------------------
// Room size
// ---------------------------------------------------------------------------

export const MIN_PLAYERS = 4
export const MAX_PLAYERS = 25

// ---------------------------------------------------------------------------
// Round timing
// ---------------------------------------------------------------------------

export const ROUND_DURATION_MIN = 30
export const HIDE_DURATION_MIN = 3
export const ROUND_DURATION_SEC = ROUND_DURATION_MIN * 60 // 1800
export const HIDE_DURATION_SEC = HIDE_DURATION_MIN * 60 // 180
export const HUNT_DURATION_SEC = ROUND_DURATION_SEC - HIDE_DURATION_SEC // 1620

// ---------------------------------------------------------------------------
// Snapshot windows: 5:00, 10:00, 15:00, 20:00, 25:00 of round time
// ---------------------------------------------------------------------------

export const SNAPSHOT_WINDOW_MIN = 5
export const SNAPSHOT_WINDOW_COUNT = 5
export const SNAPSHOT_WINDOW_SEC = SNAPSHOT_WINDOW_MIN * 60 // 300

/** window_index 0 is the bonus (photo task) snapshot; normal windows are 1..5. */
export const SNAPSHOT_BONUS_WINDOW_INDEX = 0

/** A snapshot is on time within 45 s of the window opening, late within 2 min. */
export const SNAPSHOT_ON_TIME_TOLERANCE_SEC = 45
export const SNAPSHOT_LATE_TOLERANCE_SEC = 2 * 60 // 120
export const SNAPSHOT_ON_TIME_POINTS = 10

/** A window can be resolved 2 minutes after it closes. */
export const RESOLVE_WINDOW_DELAY_SEC = 2 * 60

// ---------------------------------------------------------------------------
// Play area
// ---------------------------------------------------------------------------

export const PLAY_AREA_RADIUS_MIN_M = 100
export const PLAY_AREA_RADIUS_MAX_M = 600

// ---------------------------------------------------------------------------
// Tagging
// ---------------------------------------------------------------------------

export const TAG_DISTANCE_M = 15
export const TAG_LOCATION_MAX_AGE_SEC = 15
export const TAG_ACCURACY_MAX_M = 15
export const TAG_LOCKOUT_SEC = 20
export const TAG_POINTS_BASE = 60
export const TAG_POINTS_PER_MIN = 1

/** Finder bonus when every hider is tagged. */
export const UNTAGGED_END_BONUS = 100

/** Per-window bonus for hiders still untagged at that window. */
export const WINDOW_UNTAGGED_BONUS = 15

/** Bonus for hiders untagged at the end of the round. */
export const UNTAGGED_END_POINTS = 50

/** Silence before a pending tag is auto-confirmed. */
export const FINALIZE_TAG_SILENCE_SEC = 10

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASK_TYPES = ['reach_zone', 'stay_put', 'distance', 'photo'] as const
export type TaskType = (typeof TASK_TYPES)[number]

/** Movement task types (used by the "force a movement task" rule). */
export const TASK_MOVEMENT_TYPES: TaskType[] = ['reach_zone', 'distance']

/** Each task lasts between 4 and 8 minutes. */
export const TASK_MIN_DURATION_SEC = 4 * 60
export const TASK_MAX_DURATION_SEC = 8 * 60

export const MAX_SKIPS_PER_ROUND = 2
export const SKIP_POINTS_PENALTY = 5

/** reach_zone: stay inside a 30 m circle for 20 seconds. */
export const REACH_ZONE_RADIUS_M = 30
export const REACH_ZONE_DURATION_SEC = 20
export const REACH_ZONE_POINTS = 35

/** stay_put: stay within 10 m for 3 minutes; ignore accuracy worse than 25 m. */
export const STAY_PUT_MOVE_TOLERANCE_M = 10
export const STAY_PUT_DURATION_SEC = 3 * 60
export const STAY_PUT_ACCURACY_IGNORE_M = 25
export const STAY_PUT_POINTS = 10

/** distance: get 80 m away from the play area centre (or a given point). */
export const DISTANCE_TASK_RADIUS_M = 80
export const DISTANCE_TASK_POINTS = 20

/** photo: bonus snapshot worth 20 points. */
export const PHOTO_TASK_POINTS = 20
export const PHOTO_PROMPTS = [
  'Take a photo of something yellow',
  'Take a photo of a tree with leaves',
  'Take a photo of a bench or seat',
  'Take a photo of a building entrance',
  'Take a photo of a staircase',
  'Take a photo of a sign or poster',
  'Take a photo of a plant or flowers',
  'Take a photo of a window',
  'Take a photo of a bicycle or scooter',
  'Take a photo of something blue',
]

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export const ABILITY_TYPES = ['pulse', 'zone_scan', 'clue_card'] as const
export type AbilityType = (typeof ABILITY_TYPES)[number]

export const ABILITY_COST: Record<AbilityType, number> = {
  pulse: 1,
  zone_scan: 2,
  clue_card: 1,
}

/** 1 charge per 4 minutes of hunt time. */
export const ABILITY_CHARGE_INTERVAL_SEC = 4 * 60

/** Extra charge granted once the round reaches 20:00. */
export const ABILITY_EXTRA_CHARGE_AT_ROUND_SEC = 20 * 60

/** Cooldown between any two ability uses. */
export const ABILITY_COOLDOWN_SEC = 30

/** pulse: 80 m circle centred up to 50 m away from the nearest hider, 10 seconds. */
export const PULSE_RADIUS_M = 80
export const PULSE_MAX_OFFSET_M = 50
export const PULSE_DURATION_SEC = 10

/** The same hider cannot be pulsed twice within 5 minutes. */
export const PULSE_REPEAT_COOLDOWN_SEC = 5 * 60

/** zone_scan: count hiders in a circle up to 100 m, 20 seconds. */
export const ZONE_SCAN_MAX_RADIUS_M = 100
export const ZONE_SCAN_DURATION_SEC = 20

/** clue_card: current task type of one random hider, no name. */
export const CLUE_CARD_DURATION_SEC = 30

// ---------------------------------------------------------------------------
// Location / proximity
// ---------------------------------------------------------------------------

export const PROXIMITY_FAR_OVER_M = 150
export const PROXIMITY_NEAR_MIN_M = 50
export const PROXIMITY_NEAR_MAX_M = 150
export const PROXIMITY_CLOSE_MAX_M = 50

/** A reading older than this is reported as "unknown". */
export const PROXIMITY_READING_MAX_AGE_SEC = 30

/** Two readings implying more than this speed mark the player suspect. */
export const SPEED_LIMIT_M_PER_S = 12

// ---------------------------------------------------------------------------
// Out of bounds
// ---------------------------------------------------------------------------

export const OUT_OF_BOUNDS_SEC = 60
export const OUT_OF_BOUNDS_REVEAL_RADIUS_M = 30
export const OUT_OF_BOUNDS_REVEAL_DURATION_SEC = 10

// ---------------------------------------------------------------------------
// Last-known reveals (missed snapshot windows)
// ---------------------------------------------------------------------------

/** First miss: 60 m circle for 15 seconds. */
export const LAST_KNOWN_REVEAL_RADIUS_M = 60
export const LAST_KNOWN_REVEAL_DURATION_SEC = 15

/** Second miss in the same round: 40 m circle for 30 seconds. */
export const LAST_KNOWN_SECOND_RADIUS_M = 40
export const LAST_KNOWN_SECOND_DURATION_SEC = 30

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const STORAGE_BUCKET = 'snapshots'
export const SNAPSHOT_URL_TTL_SEC = 60

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const NICKNAME_MAX_LEN = 20

export const ROOM_STATUSES = ['lobby', 'hiding', 'hunting', 'paused', 'ended'] as const
export type RoomStatus = (typeof ROOM_STATUSES)[number]
