import {
  HOST_ENTRY_NAV_LINKS,
  HOST_NAV_TIERS,
  NAV_TIER_L2_BLOCKER_NOTE_EN,
  NAV_TIER_L2_BLOCKER_NOTE_ZH,
} from '../lib/nav-tiers';

/**
 * Host root entry: L0–L3 tier map (A5).
 * Labels teaching / windtunnel / engineering Lab / batch without claiming
 * Lab fully usable while WaveWorld #49 is open.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', lineHeight: 1.55 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>WaveWorld Host · platform entry</h1>
      <p style={{ color: '#52525b', marginTop: 0 }}>
        Backend process for jobs API + health. Product tiers (not a single “sim” surface):
      </p>

      <nav
        aria-label="Host tier shortcuts"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '12px 0 20px' }}
      >
        {HOST_ENTRY_NAV_LINKS.map((link) => (
          <a key={`${link.tier}-${link.href}`} href={link.href} style={{ color: '#0891b2' }}>
            {link.labelEn}
          </a>
        ))}
        <a href="/api/health" style={{ color: '#71717a' }}>
          Health
        </a>
      </nav>

      <section data-host-nav-tiers="L0-L3" aria-label="Platform tiers L0 to L3">
        <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>L0 → L3 map</h2>
        <ol style={{ paddingLeft: 0, listStyle: 'none', margin: 0 }}>
          {HOST_NAV_TIERS.map((tier) => (
            <li
              key={tier.id}
              data-tier={tier.id}
              data-blocked-claim={tier.blockedClaimFullyUsable ? 'true' : 'false'}
              style={{
                border: '1px solid #e4e4e7',
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 10,
                background: tier.id === 'L2' ? '#fafaf9' : '#fff',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                <strong>
                  <a href={tier.href} style={{ color: '#0e7490', textDecoration: 'none' }}>
                    {tier.titleEn}
                  </a>
                </strong>
                <span style={{ color: '#71717a', fontSize: 13 }}>({tier.shortEn})</span>
                {tier.blockedClaimFullyUsable && (
                  <span
                    style={{
                      fontSize: 11,
                      color: '#b45309',
                      border: '1px solid #fcd34d',
                      borderRadius: 6,
                      padding: '1px 6px',
                    }}
                  >
                    #{tier.blockerIssue} open · not fully usable claim
                  </span>
                )}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: '#3f3f46' }}>{tier.blurbEn}</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#a1a1aa' }}>{tier.titleZh}</p>
              {tier.relatedHrefs.length > 0 && (
                <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                  {tier.relatedHrefs.map((href, i) => (
                    <span key={href}>
                      {i > 0 ? ' · ' : ''}
                      <a href={href} style={{ color: '#0891b2' }}>
                        {href}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <aside
        data-lab-honesty="issue-49"
        style={{
          marginTop: 8,
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid #e4e4e7',
          background: '#fafafa',
          fontSize: 13,
          color: '#52525b',
        }}
      >
        <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4 }}>
          L2 honesty · Lab preview
        </div>
        <p style={{ margin: 0 }}>{NAV_TIER_L2_BLOCKER_NOTE_EN}</p>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#a1a1aa' }}>
          {NAV_TIER_L2_BLOCKER_NOTE_ZH}
        </p>
      </aside>

      <p style={{ marginTop: 24, fontSize: 13, color: '#71717a' }}>
        API: <code>GET /api/health</code> · <code>/api/v1/jobs</code> ·{' '}
        <code>/api/v1/agents/*</code>
      </p>
    </main>
  );
}
