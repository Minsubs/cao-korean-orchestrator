import { avatarColorFor, avatarVars } from './avatar'

interface AgentAvatarProps {
  name: string | null | undefined
  size?: 'sm' | 'md'
  title?: string
}

/** Small deterministic pastel "face" sticker — same visual language as the mockup's agent avatars, redrawn (not copied). */
export function AgentAvatar({ name, size = 'md', title }: AgentAvatarProps) {
  const { bg, ink } = avatarVars(avatarColorFor(name))
  const px = size === 'sm' ? 22 : 30
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: px, height: px, background: bg }}
      title={title ?? name ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      <svg viewBox="0 0 32 32" width={px} height={px}>
        <rect x="6" y="9" width="20" height="15" rx="7" fill={ink} opacity="0.18" />
        <circle cx="12.5" cy="16" r="1.8" fill={ink} />
        <circle cx="19.5" cy="16" r="1.8" fill={ink} />
        <path d="M13 20.6 Q16 22.4 19 20.6" stroke={ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  )
}
