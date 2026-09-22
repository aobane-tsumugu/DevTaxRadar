import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

/** Keeps a rendering failure from blanking the page; saved data is untouched by a reload. */
class RenderFailure extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="render-failure" role="alert">
        <h1>画面の表示中に問題が発生しました</h1>
        <p>
          保存済みの資料は変更していません。再読み込みしても直らない場合は、DevTaxを終了して起動し直してください。
        </p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </main>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RenderFailure>
      <App />
    </RenderFailure>
  </StrictMode>,
)
