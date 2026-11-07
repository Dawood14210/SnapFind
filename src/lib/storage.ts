/** Local persistence helpers: nickname and one-time rules acceptance. */

const NICKNAME_KEY = 'snapfind.nickname'
const RULES_KEY = 'snapfind.rulesAccepted'

export function getNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? ''
}

export function setNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_KEY, nickname)
}

export function areRulesAccepted(): boolean {
  return localStorage.getItem(RULES_KEY) === 'true'
}

export function acceptRules(): void {
  localStorage.setItem(RULES_KEY, 'true')
}
