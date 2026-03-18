import { memo } from 'react'
import {
  BarChart2,
  CreditCard,
  Gauge,
  Layers3,
  Layout,
  LineChart,
  Mail,
  Package,
  Radio,
  Settings,
  ShieldCheck,
  ShoppingCart,
  ClipboardCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'

interface Props {
  tab: string
  setTab: (tab: string) => void
  role?: string | null
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

const GROUPS = [
  {
    label: 'Main',
    items: [
      { id: 'overview',      label: 'Overview',      icon: Gauge },
      { id: 'mega-pipeline', label: 'Mega Pipeline',  icon: Zap },
    ],
  },
  {
    label: 'Content',
    items: [
      { id: 'products',     label: 'Products',     icon: Package },
      { id: 'assets',       label: 'Assets',       icon: Layers3 },
      { id: 'pages',        label: 'Pages',        icon: Layout },
      { id: 'sales-pages',  label: 'Sales Pages',  icon: ShoppingCart },
    ],
  },
  {
    label: 'Publish',
    items: [
      { id: 'social', label: 'Social', icon: Sparkles },
      { id: 'social-queue', label: 'Approval Queue', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Email',
    items: [
      { id: 'email-sequences',   label: 'Sequences',   icon: Mail },
      { id: 'email-broadcasts',  label: 'Broadcasts',  icon: Radio },
      { id: 'email-subscribers', label: 'Subscribers', icon: Users },
      { id: 'email-analytics',   label: 'Analytics',   icon: BarChart2 },
    ],
  },
  {
    label: 'Revenue',
    items: [
      { id: 'stripe-analytics', label: 'Stripe Sales', icon: CreditCard },
    ],
  },
  {
    label: 'Settings',
    items: [
      { id: 'account',      label: 'Account',      icon: ShieldCheck },
      { id: 'settings',     label: 'Settings',     icon: Settings },
    ],
  },
] as const

function AppSidebar({ tab, setTab, mobileOpen = false, onCloseMobile }: Props) {
  return (
    <aside className={`app-sidebar card ${mobileOpen ? 'app-sidebar-open' : ''}`}>
      {GROUPS.map(group => (
        <div key={group.label} style={{ display: 'grid', gap: 8 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>{group.label}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {group.items.map(item => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  className="btn-ghost"
                  onClick={() => {
                    setTab(item.id)
                    onCloseMobile?.()
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    background: active ? 'rgba(88,166,255,.12)' : 'transparent',
                    borderColor: active ? 'rgba(88,166,255,.35)' : 'var(--border)',
                    color: active ? 'var(--accent)' : 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <Icon size={15} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </aside>
  )
}

export default memo(AppSidebar)
