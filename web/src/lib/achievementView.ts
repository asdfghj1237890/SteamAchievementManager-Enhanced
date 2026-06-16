import type { CSSProperties } from 'react'
import { CARD_BASE, ckBase } from './styles'
import type { Translate } from '../i18n'
import type { Achievement, Game } from '../types'

export interface AchView {
  id: string
  name: string
  desc: string
  unlocked: boolean
  protected: boolean
  icon: string
  check: string
  /** Real Steam achievement icon URL (real source only); falls back to the tile. */
  iconUrl?: string
  rarityText: string
  dateText: string
  stateText: string
  showBadge: boolean
  badgeText: string | null
  iconGrid: CSSProperties
  iconList: CSSProperties
  cardStyle: CSSProperties
  rowStyle: CSSProperties
  checkStyle: CSSProperties
  stateStyle: CSSProperties
  badgeStyle: CSSProperties
}

/** Port of the design's enrich(): derive all per-achievement display values + styles. */
export function enrichAchievement(g: Game, a: Achievement, t: Translate): AchView {
  const h = (g.hue + a.rarity * 2) % 360
  const iconCommon: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
    fontFamily: "'IBM Plex Sans','Noto Sans TC',sans-serif",
  }
  const iconBg: CSSProperties = a.unlocked
    ? { background: `linear-gradient(145deg, hsl(${h} 60% 56%), hsl(${(h + 26) % 360} 64% 44%))`, color: '#fff' }
    : { background: 'var(--s3)', color: 'var(--t3)' }
  const dd = ((a.points * 7 + 3) % 26) + 1
  const demoDate = `${g.y}/${String(g.m).padStart(2, '0')}/${String(dd).padStart(2, '0')}`
  const realDate = a.unlockTime
    ? (() => {
        const d = new Date(a.unlockTime * 1000)
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
      })()
    : null
  const dateText = a.unlocked ? (realDate ?? demoDate) : t('ach.locked')
  const badge = a.protected ? t('badge.protected') : a.hidden ? t('badge.hidden') : null

  const iconFile = a.unlocked ? a.icon : a.iconGray ?? a.icon
  const iconUrl = iconFile
    ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${g.appId}/${iconFile}`
    : undefined

  return {
    id: a.id,
    name: a.name,
    desc: a.desc,
    unlocked: a.unlocked,
    protected: a.protected,
    rarityText: t('ach.rarity', { pct: a.rarity }),
    dateText,
    check: a.unlocked ? '✓' : a.protected ? '🔒' : '',
    icon: a.name[0],
    iconUrl,
    iconGrid: { ...iconCommon, ...iconBg, width: '46px', height: '46px', borderRadius: 'var(--radius)', fontSize: '20px' },
    iconList: { ...iconCommon, ...iconBg, width: '38px', height: '38px', borderRadius: 'calc(var(--radius) - 2px)', fontSize: '16px', flex: '0 0 auto' },
    cardStyle: {
      ...CARD_BASE,
      opacity: a.unlocked ? 1 : 0.86,
      borderColor: a.protected
        ? 'color-mix(in srgb, var(--danger) 38%, var(--bd))'
        : a.unlocked
          ? 'color-mix(in srgb, var(--accent) 32%, var(--bd))'
          : 'var(--bd)',
    },
    rowStyle: {
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: 'calc(var(--cardpad) - 3px) var(--cardpad)', borderBottom: '1px solid var(--bds)',
      cursor: 'pointer', opacity: a.unlocked ? 1 : 0.84, transition: 'background .12s',
    },
    checkStyle: a.unlocked
      ? { ...ckBase, background: 'var(--accent)', borderColor: 'var(--accent)' }
      : a.protected
        ? { ...ckBase, borderStyle: 'dashed', color: 'var(--t3)', cursor: 'not-allowed', fontSize: '11px' }
        : { ...ckBase },
    stateText: a.unlocked ? t('ach.unlockedOn', { date: dateText }) : a.protected ? t('badge.protected') : t('ach.stateLocked'),
    stateStyle: {
      fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '999px', whiteSpace: 'nowrap',
      fontFamily: a.unlocked ? 'var(--meta)' : 'inherit',
      color: a.unlocked ? 'var(--good)' : a.protected ? 'var(--danger)' : 'var(--t3)',
      background: a.unlocked
        ? 'color-mix(in srgb, var(--good) 15%, transparent)'
        : a.protected
          ? 'color-mix(in srgb, var(--danger) 13%, transparent)'
          : 'var(--s3)',
    },
    showBadge: !!badge,
    badgeText: badge,
    // Inline pill (sits in the card's bottom meta row); previously absolute in the
    // top-right corner where it covered the unlock checkbox.
    badgeStyle: {
      fontSize: '10px', fontWeight: 700, letterSpacing: '.5px', padding: '2px 7px',
      borderRadius: '999px', fontFamily: 'var(--meta)', whiteSpace: 'nowrap', flex: '0 0 auto',
      color: a.protected ? 'var(--danger)' : 'var(--t2)',
      background: a.protected ? 'color-mix(in srgb, var(--danger) 14%, transparent)' : 'var(--s3)',
      border: '1px solid var(--bd)',
    },
  }
}
