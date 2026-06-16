import type { ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import { ACCENT_OPTIONS } from '../lib/theme'
import { LANGS, type I18nKey, type Lang } from '../i18n'
import type { Platform, Theme } from '../types'
import Seg from './ui/Seg'

const THEME_OPTS: [Theme, string, I18nKey][] = [
  ['dark', '☾', 'theme.dark'],
  ['light', '☀', 'theme.light'],
]
const PLATFORM_OPTS: [Platform, string][] = [['mac', 'macOS'], ['windows', 'Windows']]

function SettingRow({
  title, desc, gap = '6px', children,
}: {
  title: string
  desc: string
  gap?: string
  children: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px',
        padding: '16px 18px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--bd)',
        background: 'var(--s2)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)' }}>{title}</div>
        <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '3px' }}>{desc}</div>
      </div>
      <div style={{ display: 'flex', gap, flex: '0 0 auto' }}>{children}</div>
    </div>
  )
}

export default function Settings() {
  const { state, t, set } = useApp()

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '26px 28px', minHeight: 0 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 700, letterSpacing: '-.3px', color: 'var(--t1)' }}>
        {t('nav.settings')}
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--t2)' }}>
        {t('settings.subtitle')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '13px', maxWidth: '580px' }}>
        <SettingRow title={t('settings.theme')} desc={t('settings.themeDesc')}>
          {THEME_OPTS.map(([k, symbol, key]) => (
            <Seg
              key={k}
              active={state.theme === k}
              onClick={() => set({ theme: k })}
              style={state.theme === k ? { padding: '7px 15px' } : { padding: '7px 15px', color: 'var(--t1)' }}
            >
              {symbol} {t(key)}
            </Seg>
          ))}
        </SettingRow>

        <SettingRow title={t('settings.language')} desc={t('settings.languageDesc')}>
          <select
            value={state.lang}
            onChange={(e) => set({ lang: e.target.value as Lang })}
            style={{
              padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--bd)',
              background: 'var(--s0)', color: 'var(--t1)', fontSize: '13px', fontFamily: 'inherit',
              cursor: 'pointer', outline: 'none', minWidth: '150px',
            }}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow title={t('settings.window')} desc={t('settings.windowDesc')}>
          {PLATFORM_OPTS.map(([k, label]) => (
            <Seg key={k} active={state.platform === k} onClick={() => set({ platform: k })} style={{ padding: '7px 13px' }}>
              {label}
            </Seg>
          ))}
        </SettingRow>

        <SettingRow title={t('settings.accent')} desc={t('settings.accentDesc')} gap="11px">
          {ACCENT_OPTIONS.map((c) => (
            <div
              key={c}
              onClick={() => set({ accent: c })}
              style={{
                width: '28px', height: '28px', borderRadius: '50%', background: c, cursor: 'pointer',
                transition: 'all .15s',
                boxShadow: state.accent === c
                  ? '0 0 0 2px var(--s2), 0 0 0 4px ' + c
                  : 'inset 0 0 0 1px rgba(255,255,255,.18)',
              }}
            />
          ))}
        </SettingRow>

        <p style={{ fontSize: '11.5px', color: 'var(--t3)', margin: '6px 2px 0', lineHeight: 1.6 }}>
          {t('settings.tip')}
        </p>
      </div>
    </div>
  )
}
