import { useState, useEffect } from 'react'
import { getBlogPosts } from '../api'
import { FileText, RefreshCw } from 'lucide-react'

export default function ContentPanel() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setPosts(await getBlogPosts()) } catch { setPosts([]) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div style={{ padding: 24 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div className="section-title" style={{ marginBottom: 4 }}>Generated Blog Posts</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Stored in outputs/blog/ · Ready for WordPress</div>
          </div>
          <button className="btn-ghost" onClick={load} disabled={loading} style={{ fontSize: 12 }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Filename</th>
              <th>Size</th>
              <th>Generated</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {posts.length === 0
              ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
                    <FileText size={32} style={{ display: 'block', margin: '0 auto 8px' }} />
                    No blog posts generated yet. Launch a pipeline to create content.
                  </td>
                </tr>
              )
              : posts.map((p, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={13} color="var(--muted)" />
                    {p.filename}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{p.size_kb} KB</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{p.modified?.slice(0, 16)}</td>
                  <td>
                    {p.filename.includes('seo.json')
                      ? <span className="badge badge-blue">SEO Meta</span>
                      : <span className="badge badge-green">Markdown</span>
                    }
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
        {posts.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
            {posts.length} files · SEO JSON files contain Yoast/RankMath meta data
          </div>
        )}
      </div>
    </div>
  )
}
