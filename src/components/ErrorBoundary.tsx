import { Component, type ReactNode } from 'react'
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="min-h-screen flex flex-col items-center justify-center gap-5 p-6 text-center"><h1 className="text-2xl font-bold">Something went wrong</h1><p>Your sign-in is saved on this device. Reload to rejoin.</p><button className="rounded-xl bg-slate-900 px-6 py-4 text-white" onClick={() => window.location.reload()}>Reload</button></main>
    return this.props.children
  }
}
