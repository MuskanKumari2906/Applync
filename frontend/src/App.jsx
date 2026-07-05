import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import './App.css';

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ─── AXIOS SETUP ─────────────────────────────────────────────────────────────
const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const fmtCurrency = (n) => n ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
const daysFromNow = (d) => Math.ceil((new Date(d) - new Date()) / 86400000);
const initials = (name) => (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

const calculateMatch = (resumeText, jdText) => {
  if (!resumeText || !jdText) return { score: 0, matched: [], missing: [], suggest: [] };
  const knownSkills = [
    "Python", "Java", "JavaScript", "TypeScript", "Go", "Rust", "C++", "C#",
    "React", "Vue", "Angular", "Node.js", "FastAPI", "Django", "Flask", "Spring",
    "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch",
    "Docker", "Kubernetes", "AWS", "GCP", "Azure", "Terraform", "CI/CD",
    "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "NLP",
    "REST API", "GraphQL", "Microservices", "Git", "Linux",
    "Agile", "Scrum", "Figma", "Jira", "Confluence",
    "Excel", "Tableau", "Power BI", "Data Analysis", "Statistics"
  ];
  
  // Extract skills present in Resume
  const resumeSkills = knownSkills.filter(s => {
    const esc = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, 'i').test(resumeText);
  });
  
  // Extract skills present in Job Description
  const jdSkills = knownSkills.filter(s => {
    const esc = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, 'i').test(jdText);
  });

  if (jdSkills.length === 0) return { score: 0, matched: [], missing: [], suggest: [] };
  
  const matched = jdSkills.filter(s => resumeSkills.some(rs => rs.toLowerCase() === s.toLowerCase()));
  const missing = jdSkills.filter(s => !resumeSkills.some(rs => rs.toLowerCase() === s.toLowerCase()));
  const score = Math.round((matched.length / jdSkills.length) * 100);

  return {
    score,
    matched,
    missing,
    suggest: missing.slice(0, 3)
  };
};

const INTERVIEW_TYPES = [
  { value: 'phone_screen', label: 'Phone Screen' },
  { value: 'technical', label: 'Technical' },
  { value: 'system_design', label: 'System Design' },
  { value: 'hr', label: 'HR Round' },
  { value: 'culture_fit', label: 'Culture Fit' },
  { value: 'case_study', label: 'Case Study' },
  { value: 'assignment', label: 'Assignment' },
];

const PLATFORMS = ['Google Meet', 'Zoom', 'Microsoft Teams', 'Phone', 'In-Person', 'Other'];

const STATUS_OPTIONS = ['applied', 'interview', 'offer', 'rejected', 'withdrawn', 'archived'];

const KANBAN_COLUMNS = [
  { key: 'applied',   label: 'Applied',   color: '#3b82f6' },
  { key: 'interview', label: 'Interview',  color: '#f59e0b' },
  { key: 'offer',     label: 'Offer',      color: '#10b981' },
  { key: 'rejected',  label: 'Rejected',   color: '#6b7280' },
  { key: 'withdrawn', label: 'Withdrawn',  color: '#8b5cf6' },
];

// ─── AUTH HOOK ────────────────────────────────────────────────────────────────
function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/auth/me')
        .then(r => setUser(r.data))
        .catch(() => { localStorage.removeItem('token'); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.access_token);
    setUser(data.user);
  };

  const register = async (email, password, full_name) => {
    const { data } = await api.post('/auth/register', { email, password, full_name });
    localStorage.setItem('token', data.access_token);
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const updateUser = (updated) => setUser(u => ({ ...u, ...updated }));

  return { user, loading, login, register, logout, updateUser };
}

// ─── THEME HOOK ───────────────────────────────────────────────────────────────
function useTheme(user, updateUser) {
  const [theme, setTheme] = useState(() => user?.theme_preference || localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    if (user?.theme_preference && user.theme_preference !== theme) {
      setTheme(user.theme_preference);
    }
  }, [user?.theme_preference]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    if (user) {
      try {
        await api.put('/auth/me', { theme_preference: newTheme });
        updateUser({ theme_preference: newTheme });
      } catch (err) {
        console.error("Failed to save theme preference:", err);
      }
    }
  };
  return { theme, toggle };
}



// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`status-badge ${status}`}>{label}</span>;
}

// ─── DEADLINE BADGE ───────────────────────────────────────────────────────────
function DeadlineBadge({ deadline }) {
  if (!deadline) return null;
  const days = daysFromNow(deadline);
  const cls = days <= 2 ? 'urgent' : days <= 6 ? 'soon' : 'normal';
  const label = days < 0 ? 'Overdue' : days === 0 ? 'Today!' : `${days}d left`;
  return <span className={`deadline-badge ${cls}`}>⏰ {label}</span>;
}

// ─── STAR RATING ──────────────────────────────────────────────────────────────
function StarRating({ value, max = 5 }) {
  return (
    <div className="rating-stars">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`rating-star ${i < value ? 'filled' : ''}`}>★</span>
      ))}
    </div>
  );
}

// ─── LOADING SCREEN ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <p className="loading-text">Loading Applync…</p>
    </div>
  );
}

// ─── MODAL WRAPPER ────────────────────────────────────────────────────────────
function Modal({ children, onClose, size = '' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ─── ACTIVITY CHART (Canvas sparkline) ───────────────────────────────────────
function ActivityChart({ data }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width = w;
    canvas.height = h;

    const counts = data.map(d => d.count);
    const max = Math.max(...counts, 1);
    const stepX = w / (counts.length - 1 || 1);

    ctx.clearRect(0, 0, w, h);

    // Fill area
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(79,124,255,0.25)');
    grad.addColorStop(1, 'rgba(79,124,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, h);
    counts.forEach((c, i) => {
      const x = i * stepX;
      const y = h - (c / max) * (h - 10) - 5;
      i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo((counts.length - 1) * stepX, h);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = '#4f7cff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    counts.forEach((c, i) => {
      const x = i * stepX;
      const y = h - (c / max) * (h - 10) - 5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data]);

  return (
    <div className="activity-chart-wrap" style={{ height: 120 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

// ─── FUNNEL CHART ─────────────────────────────────────────────────────────────
function FunnelChart({ stages }) {
  if (!stages) return <p className="text-muted" style={{ fontSize: 13 }}>No data yet.</p>;
  return (
    <div className="funnel-chart">
      {stages.map((s) => (
        <div key={s.name} className="funnel-stage">
          <div className="funnel-stage-header">
            <span className="funnel-stage-name">{s.name}</span>
            <span>
              <span className="funnel-stage-count">{s.count}</span>
              <span className="funnel-stage-rate"> · {s.rate}%</span>
            </span>
          </div>
          <div className="funnel-bar">
            <div
              className="funnel-bar-fill"
              style={{ width: `${s.rate}%`, background: s.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ user, onLogout, currentPage, onNavigate, jobCount, sidebarOpen, onClose }) {
  const nav = [
    { key: 'dashboard', label: 'Dashboard', icon: '⊞' },
    { key: 'kanban',    label: 'Pipeline',   icon: '▦' },
    { key: 'analytics', label: 'Analytics',  icon: '↗' },
    { key: 'settings',  label: 'Settings',   icon: '⚙' },
  ];

  return (
    <>
      {sidebarOpen && <div className="sidebar-overlay open" onClick={onClose} />}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">A</div>
          <span className="sidebar-logo-text">Applync</span>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">Navigation</div>
          {nav.map(n => (
            <button
              key={n.key}
              className={`sidebar-nav-item ${currentPage === n.key ? 'active' : ''}`}
              onClick={() => { onNavigate(n.key); onClose(); }}
            >
              <span className="sidebar-nav-icon">{n.icon}</span>
              {n.label}
              {n.key === 'dashboard' && jobCount != null && (
                <span className="sidebar-nav-badge">{jobCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div
            className="sidebar-user"
            onClick={() => { onNavigate('settings'); onClose(); }}
            title="Profile & Settings"
          >
            <div className="sidebar-avatar">{initials(user?.full_name)}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.full_name || 'User'}</div>
              <div className="sidebar-user-email">{user?.email}</div>
            </div>
          </div>
          <button
            className="sidebar-nav-item"
            style={{ color: '#ef4444', marginTop: 4 }}
            onClick={onLogout}
          >
            <span className="sidebar-nav-icon">⎋</span>
            Log out
          </button>
        </div>
      </aside>
    </>
  );
}

// ─── ADD/EDIT JOB MODAL ───────────────────────────────────────────────────────
function AddJobModal({ jobId, onClose, onSaved }) {
  const [form, setForm] = useState({
    company_name: '', position_title: '', job_url: '',
    job_description: '', status: 'applied',
    application_date: new Date().toISOString().split('T')[0],
    deadline_date: '', notes: '', salary_range: '',
    company_industry: '', company_size: '', location: '', is_starred: false,
  });
  const [parseText, setParseText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseOpen, setParseOpen] = useState(false);
  const [parsedSkills, setParsedSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!jobId) return;
    api.get(`/jobs/${jobId}`).then(r => {
      const d = r.data;
      setForm({
        company_name: d.company_name || '',
        position_title: d.position_title || '',
        job_url: d.job_url || '',
        job_description: d.job_description || '',
        status: d.status || 'applied',
        application_date: d.application_date ? d.application_date.split('T')[0] : new Date().toISOString().split('T')[0],
        deadline_date: d.deadline_date ? d.deadline_date.split('T')[0] : '',
        notes: d.notes || '',
        salary_range: d.salary_range || '',
        company_industry: d.company_industry || '',
        company_size: d.company_size || '',
        location: d.location || '',
        is_starred: d.is_starred || false,
      });
    }).catch(() => setError('Failed to load job data'));
  }, [jobId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleParse = async () => {
    if (!parseText.trim()) return;
    setParsing(true);
    try {
      const { data } = await api.post('/jobs/parse', { text: parseText });
      if (data.company_name && !form.company_name) set('company_name', data.company_name);
      if (data.position_title && !form.position_title) set('position_title', data.position_title);
      if (data.location) set('location', data.location);
      if (data.salary_range) set('salary_range', data.salary_range);
      if (data.company_industry) set('company_industry', data.company_industry);
      set('job_description', parseText);
      setParsedSkills(data.skills || []);
    } catch {
      setError('Parsing failed. Try with more text.');
    }
    setParsing(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.company_name.trim() || !form.position_title.trim()) {
      setError('Company name and position are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = {
        ...form,
        deadline_date: form.deadline_date || null,
        application_date: form.application_date || new Date().toISOString(),
      };
      if (jobId) {
        await api.put(`/jobs/${jobId}`, payload);
      } else {
        await api.post('/jobs', payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save.');
    }
    setLoading(false);
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-header">
        <h2 className="modal-title">{jobId ? 'Edit Application' : 'New Application'}</h2>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="modal-body">

          {/* JD Parser */}
          <div className="parser-panel">
            <div className="parser-panel-header" onClick={() => setParseOpen(o => !o)}>
              <span className="parser-panel-title">✦ Paste Job Description to Auto-fill</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{parseOpen ? '▲ Hide' : '▼ Show'}</span>
            </div>
            {parseOpen && (
              <div className="parser-panel-body">
                <textarea
                  className="form-textarea"
                  rows={5}
                  placeholder="Paste the full job description here and click Parse…"
                  value={parseText}
                  onChange={e => setParseText(e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleParse} disabled={parsing}>
                    {parsing ? 'Parsing…' : '⚡ Parse & Auto-fill'}
                  </button>
                </div>
                {parsedSkills.length > 0 && (
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Detected Skills</p>
                    <div className="parser-skills">
                      {parsedSkills.map(s => <span key={s} className="parser-result-tag">{s}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Core Fields */}
          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">Company Name *</label>
              <input className="form-input" value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="e.g. Google" required />
            </div>
            <div className="form-field">
              <label className="form-label">Position *</label>
              <input className="form-input" value={form.position_title} onChange={e => set('position_title', e.target.value)} placeholder="e.g. Software Engineer" required />
            </div>
          </div>

          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Job URL</label>
              <input className="form-input" type="url" value={form.job_url} onChange={e => set('job_url', e.target.value)} placeholder="https://…" />
            </div>
          </div>

          <div className="form-grid form-grid-3">
            <div className="form-field">
              <label className="form-label">Applied On</label>
              <input className="form-input" type="date" value={form.application_date} onChange={e => set('application_date', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Deadline</label>
              <input className="form-input" type="date" value={form.deadline_date} onChange={e => set('deadline_date', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Salary Range</label>
              <input className="form-input" value={form.salary_range} onChange={e => set('salary_range', e.target.value)} placeholder="e.g. 15–20 LPA" />
            </div>
          </div>

          <div className="form-grid form-grid-3">
            <div className="form-field">
              <label className="form-label">Location</label>
              <input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Remote / Bengaluru" />
            </div>
            <div className="form-field">
              <label className="form-label">Industry</label>
              <input className="form-input" value={form.company_industry} onChange={e => set('company_industry', e.target.value)} placeholder="Tech / Finance…" />
            </div>
            <div className="form-field">
              <label className="form-label">Company Size</label>
              <select className="form-select" value={form.company_size} onChange={e => set('company_size', e.target.value)}>
                <option value="">Select…</option>
                <option value="startup">Startup (&lt;50)</option>
                <option value="mid">Mid (50–500)</option>
                <option value="large">Large (500+)</option>
                <option value="enterprise">Enterprise (5000+)</option>
              </select>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Key details, prep strategy, referral info…" />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={form.is_starred} onChange={e => set('is_starred', e.target.checked)} style={{ accentColor: '#f59e0b' }} />
            ⭐ Star this application
          </label>

          {error && <div className="auth-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : jobId ? 'Save Changes' : 'Add Application'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── INTERVIEW MODAL ──────────────────────────────────────────────────────────
function InterviewModal({ jobId, interview, onClose, onSaved }) {
  const [form, setForm] = useState({
    round_number: (interview?.round_number) || 1,
    interview_type: interview?.interview_type || 'phone_screen',
    scheduled_date: interview?.scheduled_date ? interview.scheduled_date.split('T')[0] : '',
    interviewer_name: interview?.interviewer_name || '',
    platform: interview?.platform || '',
    duration_minutes: interview?.duration_minutes || '',
    status: interview?.status || 'scheduled',
    feedback: interview?.feedback || '',
    difficulty_rating: interview?.difficulty_rating || 0,
    performance_rating: interview?.performance_rating || 0,
    what_went_well: interview?.what_went_well || '',
    improvements: interview?.improvements || '',
    follow_up_actions: interview?.follow_up_actions || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        ...form,
        scheduled_date: form.scheduled_date ? new Date(form.scheduled_date).toISOString() : null,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
        difficulty_rating: form.difficulty_rating || null,
        performance_rating: form.performance_rating || null,
      };
      if (interview?.id) {
        await api.put(`/interviews/${interview.id}`, payload);
      } else {
        await api.post(`/jobs/${jobId}/interviews`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save interview.');
    }
    setLoading(false);
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-header">
        <h2 className="modal-title">{interview ? 'Edit Interview' : 'Schedule Interview'}</h2>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          <div className="form-section-title">Interview Details</div>

          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">Round Number</label>
              <input className="form-input" type="number" min="1" max="10" value={form.round_number} onChange={e => set('round_number', Number(e.target.value))} />
            </div>
            <div className="form-field">
              <label className="form-label">Interview Type</label>
              <select className="form-select" value={form.interview_type} onChange={e => set('interview_type', e.target.value)}>
                {INTERVIEW_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">Date</label>
              <input className="form-input" type="date" value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Platform</label>
              <select className="form-select" value={form.platform} onChange={e => set('platform', e.target.value)}>
                <option value="">Select…</option>
                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">Interviewer Name</label>
              <input className="form-input" value={form.interviewer_name} onChange={e => set('interviewer_name', e.target.value)} placeholder="e.g. Priya Sharma" />
            </div>
            <div className="form-field">
              <label className="form-label">Duration (minutes)</label>
              <input className="form-input" type="number" min="15" step="15" value={form.duration_minutes} onChange={e => set('duration_minutes', e.target.value)} placeholder="60" />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
              {['scheduled', 'completed', 'passed', 'failed', 'cancelled'].map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          <div className="form-section-title">Feedback (after interview)</div>

          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">Difficulty (1–5)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1,2,3,4,5].map(n => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => set('difficulty_rating', n)}
                    style={{
                      width: 32, height: 32, borderRadius: 6, border: `1px solid ${form.difficulty_rating >= n ? '#f59e0b' : 'var(--border)'}`,
                      background: form.difficulty_rating >= n ? 'rgba(245,158,11,0.15)' : 'var(--bg-elevated)',
                      color: form.difficulty_rating >= n ? '#f59e0b' : 'var(--text-muted)',
                      cursor: 'pointer', fontWeight: 700, fontSize: 13,
                    }}
                  >{n}</button>
                ))}
              </div>
            </div>
            <div className="form-field">
              <label className="form-label">My Performance (1–5)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1,2,3,4,5].map(n => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => set('performance_rating', n)}
                    style={{
                      width: 32, height: 32, borderRadius: 6, border: `1px solid ${form.performance_rating >= n ? '#4f7cff' : 'var(--border)'}`,
                      background: form.performance_rating >= n ? 'rgba(79,124,255,0.15)' : 'var(--bg-elevated)',
                      color: form.performance_rating >= n ? '#4f7cff' : 'var(--text-muted)',
                      cursor: 'pointer', fontWeight: 700, fontSize: 13,
                    }}
                  >{n}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">What went well</label>
            <textarea className="form-textarea" rows={2} value={form.what_went_well} onChange={e => set('what_went_well', e.target.value)} placeholder="Strong points, good answers…" />
          </div>

          <div className="form-field">
            <label className="form-label">Improvements needed</label>
            <textarea className="form-textarea" rows={2} value={form.improvements} onChange={e => set('improvements', e.target.value)} placeholder="Areas to work on next time…" />
          </div>

          <div className="form-field">
            <label className="form-label">Follow-up actions</label>
            <textarea className="form-textarea" rows={2} value={form.follow_up_actions} onChange={e => set('follow_up_actions', e.target.value)} placeholder="Send thank-you email, prepare for round 2…" />
          </div>

          <div className="form-field">
            <label className="form-label">General Notes</label>
            <textarea className="form-textarea" rows={2} value={form.feedback} onChange={e => set('feedback', e.target.value)} placeholder="Any other notes about this round…" />
          </div>

          {error && <div className="auth-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : interview ? 'Save Changes' : 'Schedule Interview'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── OFFER MODAL ──────────────────────────────────────────────────────────────
function OfferModal({ jobId, offer, onClose, onSaved }) {
  const [form, setForm] = useState({
    ctc: offer?.ctc || '',
    base_salary: offer?.base_salary || '',
    bonus_percent: offer?.bonus_percent || '',
    stock_options: offer?.stock_options || '',
    benefits: offer?.benefits || '',
    negotiation_status: offer?.negotiation_status || 'pending',
    offer_date: offer?.offer_date ? offer.offer_date.split('T')[0] : '',
    response_deadline: offer?.response_deadline ? offer.response_deadline.split('T')[0] : '',
    notes: offer?.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        ...form,
        ctc: form.ctc ? Number(form.ctc) : null,
        base_salary: form.base_salary ? Number(form.base_salary) : null,
        bonus_percent: form.bonus_percent ? Number(form.bonus_percent) : null,
        offer_date: form.offer_date ? new Date(form.offer_date).toISOString() : null,
        response_deadline: form.response_deadline ? new Date(form.response_deadline).toISOString() : null,
      };
      if (offer?.id) {
        await api.put(`/jobs/${jobId}/offer`, payload);
      } else {
        await api.post(`/jobs/${jobId}/offer`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save offer.');
    }
    setLoading(false);
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-header">
        <h2 className="modal-title">💰 {offer ? 'Edit Offer' : 'Record Offer'}</h2>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          <div className="form-section-title">Compensation</div>
          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">CTC (Annual, ₹)</label>
              <input className="form-input" type="number" value={form.ctc} onChange={e => set('ctc', e.target.value)} placeholder="e.g. 1800000" />
            </div>
            <div className="form-field">
              <label className="form-label">Base Salary (₹)</label>
              <input className="form-input" type="number" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} placeholder="e.g. 1500000" />
            </div>
          </div>
          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">Bonus (%)</label>
              <input className="form-input" type="number" value={form.bonus_percent} onChange={e => set('bonus_percent', e.target.value)} placeholder="e.g. 10" />
            </div>
            <div className="form-field">
              <label className="form-label">Stock / ESOP</label>
              <input className="form-input" value={form.stock_options} onChange={e => set('stock_options', e.target.value)} placeholder="e.g. 100 RSUs over 4yr" />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Benefits</label>
            <textarea className="form-textarea" rows={2} value={form.benefits} onChange={e => set('benefits', e.target.value)} placeholder="Health insurance, gym, laptop, WFH stipend…" />
          </div>

          <div className="form-section-title">Status & Timeline</div>
          <div className="form-grid form-grid-2">
            <div className="form-field">
              <label className="form-label">Offer Date</label>
              <input className="form-input" type="date" value={form.offer_date} onChange={e => set('offer_date', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Response Deadline</label>
              <input className="form-input" type="date" value={form.response_deadline} onChange={e => set('response_deadline', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Negotiation Status</label>
            <select className="form-select" value={form.negotiation_status} onChange={e => set('negotiation_status', e.target.value)}>
              {['pending', 'negotiating', 'accepted', 'rejected'].map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Negotiation notes, joining date…" />
          </div>

          {error && <div className="auth-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : '💾 Save Offer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── JOB DETAIL MODAL ─────────────────────────────────────────────────────────
function JobDetailModal({ jobId, onClose, onRefresh, user }) {
  const [job, setJob] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [offer, setOffer] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [showInterviewModal, setShowInterviewModal] = useState(false);
  const [editInterview, setEditInterview] = useState(null);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [jobR, intR, tlR] = await Promise.all([
        api.get(`/jobs/${jobId}`),
        api.get(`/jobs/${jobId}/interviews`),
        api.get(`/jobs/${jobId}/timeline`),
      ]);
      setJob(jobR.data);
      setInterviews(intR.data);
      setTimeline(tlR.data);
      // Attempt offer fetch — may 404 if none
      try {
        const offerR = await api.get(`/jobs/${jobId}/offer`);
        setOffer(offerR.data);
      } catch { setOffer(null); }
    } catch {
      onClose();
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDelete = async () => {
    if (!window.confirm('Delete this application? This cannot be undone.')) return;
    await api.delete(`/jobs/${jobId}`);
    onRefresh();
    onClose();
  };

  const handleDeleteInterview = async (id) => {
    if (!window.confirm('Delete this interview?')) return;
    await api.delete(`/interviews/${id}`);
    fetchAll();
  };

  const interviewTypeLabel = (t) => INTERVIEW_TYPES.find(x => x.value === t)?.label || t;

  if (loading) return (
    <Modal onClose={onClose} size="modal-xl">
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div className="loading-spinner" style={{ margin: '0 auto' }} />
      </div>
    </Modal>
  );

  if (!job) return null;

  const TABS = ['overview', 'interviews', 'offer', 'timeline'];

  return (
    <Modal onClose={onClose} size="modal-xl">
      <div className="modal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="job-company-logo">{job.company_name[0]}</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{job.position_title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{job.company_name}</div>
          </div>
          <StatusBadge status={job.status} />
          {job.is_starred && <span style={{ fontSize: 16 }}>⭐</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              textTransform: 'capitalize',
              marginBottom: -1,
            }}
          >
            {t}
            {t === 'interviews' && interviews.length > 0 && (
              <span style={{ marginLeft: 6, background: 'var(--status-interview-bg)', color: 'var(--status-interview-text)', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>
                {interviews.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && (
          <div className="job-detail-layout">
            <div className="job-detail-main">
              <div>
                <div className="section-title" style={{ marginBottom: 16 }}>Application Info</div>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-item-label">Applied On</span>
                    <span className="info-item-value">{fmtDate(job.application_date)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-item-label">Deadline</span>
                    <span className="info-item-value">{fmtDate(job.deadline_date)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-item-label">Location</span>
                    <span className="info-item-value">{job.location || '—'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-item-label">Salary Range</span>
                    <span className="info-item-value">{job.salary_range || '—'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-item-label">Industry</span>
                    <span className="info-item-value">{job.company_industry || '—'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-item-label">Company Size</span>
                    <span className="info-item-value">{job.company_size || '—'}</span>
                  </div>
                </div>
              </div>

              {/* Resume Match Score */}
              <div className="card card-padding" style={{ marginBottom: 20 }}>
                <div className="detail-section-title">✨ Resume Match Score</div>
                {!user?.resume_text ? (
                  <p className="text-secondary" style={{ fontSize: 13 }}>
                    Please add your resume text in <strong>Settings</strong> to enable match scoring.
                  </p>
                ) : !job.job_description ? (
                  <p className="text-secondary" style={{ fontSize: 13 }}>
                    Add the full job description in <strong>Edit Job</strong> to calculate matching score.
                  </p>
                ) : (() => {
                  const match = calculateMatch(user?.resume_text, job.job_description);
                  const scoreColor = match.score >= 70 ? 'var(--status-offer-text)' : match.score >= 40 ? 'var(--status-interview-text)' : 'var(--text-muted)';
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ fontSize: 36, fontWeight: 800, color: scoreColor }}>
                          {match.score}%
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          relevance match based on detected skills.
                        </div>
                      </div>
                      <div className="funnel-bar">
                        <div className="funnel-bar-fill" style={{ width: `${match.score}%`, background: scoreColor }} />
                      </div>
                      
                      {match.matched.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Matched Skills ({match.matched.length})</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {match.matched.map(s => <span key={s} className="parser-result-tag" style={{ background: 'var(--status-offer-bg)', color: 'var(--status-offer-text)', borderColor: 'rgba(16,185,129,0.2)' }}>{s}</span>)}
                          </div>
                        </div>
                      )}
                      
                      {match.missing.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Missing Skills ({match.missing.length})</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {match.missing.map(s => <span key={s} className="parser-result-tag" style={{ background: 'var(--status-rejected-bg)', color: 'var(--status-rejected-text)', borderColor: 'rgba(107,114,128,0.2)' }}>{s}</span>)}
                          </div>
                        </div>
                      )}

                      {match.suggest.length > 0 && (
                        <div style={{ padding: 10, background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 12, borderLeft: '3px solid var(--accent)' }}>
                          <strong>💡 Tip:</strong> Try emphasizing <strong>{match.suggest.join(', ')}</strong> in your application/resume for this role.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {job.notes && (
                <div>
                  <div className="detail-section-title">Notes</div>
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 16px', fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-secondary)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}>
                    {job.notes}
                  </div>
                </div>
              )}

              {job.job_url && (
                <a href={job.job_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
                  ↗ View Job Posting
                </a>
              )}
            </div>

            <div className="job-detail-sidebar">
              {/* Quick Actions */}
              <div className="card card-padding-sm">
                <div className="detail-section-title">Quick Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setShowInterviewModal(true); }}>
                    + Schedule Interview
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowOfferModal(true)}>
                    💰 {offer ? 'Edit Offer' : 'Record Offer'}
                  </button>
                  {job.deadline_date && <DeadlineBadge deadline={job.deadline_date} />}
                </div>
              </div>

              {/* Interview Summary */}
              {interviews.length > 0 && (
                <div className="card card-padding-sm">
                  <div className="detail-section-title">Interview Summary</div>
                  {interviews.map(iv => (
                    <div key={iv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>R{iv.round_number} · {interviewTypeLabel(iv.interview_type)}</span>
                      <StatusBadge status={iv.status} />
                    </div>
                  ))}
                </div>
              )}

              {/* Offer Preview */}
              {offer && (
                <div className="offer-card has-offer">
                  <div className="offer-card-title">💰 Offer Received</div>
                  {offer.ctc && <div className="offer-ctc">{fmtCurrency(offer.ctc)}</div>}
                  <div className="offer-salary-note">Annual CTC</div>
                  <StatusBadge status={offer.negotiation_status} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── INTERVIEWS TAB ── */}
        {tab === 'interviews' && (
          <div>
            <div className="section-header">
              <span className="section-title">Interview Rounds</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowInterviewModal(true)}>
                + Add Round
              </button>
            </div>

            {interviews.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <div className="empty-state-icon">📅</div>
                <div className="empty-state-title">No interviews yet</div>
                <div className="empty-state-text">Schedule your first interview round to start tracking your progress.</div>
              </div>
            ) : (
              <div className="interview-timeline">
                {interviews.map((iv, idx) => (
                  <div key={iv.id} className="interview-timeline-item">
                    <div className="timeline-connector">
                      <div className={`timeline-dot ${iv.status}`}>{iv.round_number}</div>
                      {idx < interviews.length - 1 && <div className="timeline-line" />}
                    </div>
                    <div className="timeline-content">
                      <div className="timeline-content-header">
                        <span className="timeline-interview-type">{interviewTypeLabel(iv.interview_type)}</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <StatusBadge status={iv.status} />
                          <button className="btn btn-ghost btn-sm" onClick={() => { setEditInterview(iv); setShowInterviewModal(true); }}>Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDeleteInterview(iv.id)}>✕</button>
                        </div>
                      </div>

                      <div className="timeline-interview-meta">
                        {iv.scheduled_date && (
                          <div className="timeline-meta-row">📅 {fmtDate(iv.scheduled_date)}</div>
                        )}
                        {iv.platform && (
                          <div className="timeline-meta-row">📞 {iv.platform}</div>
                        )}
                        {iv.interviewer_name && (
                          <div className="timeline-meta-row">👤 {iv.interviewer_name}</div>
                        )}
                        {iv.duration_minutes && (
                          <div className="timeline-meta-row">⏱ {iv.duration_minutes} min</div>
                        )}
                      </div>

                      {(iv.difficulty_rating || iv.performance_rating) && (
                        <div className="timeline-ratings">
                          {iv.difficulty_rating && (
                            <div className="timeline-rating-item">
                              <div className="rating-label">Difficulty</div>
                              <StarRating value={iv.difficulty_rating} />
                            </div>
                          )}
                          {iv.performance_rating && (
                            <div className="timeline-rating-item">
                              <div className="rating-label">My Performance</div>
                              <StarRating value={iv.performance_rating} />
                            </div>
                          )}
                        </div>
                      )}

                      {(iv.what_went_well || iv.improvements || iv.follow_up_actions || iv.feedback) && (
                        <div className="interview-feedback-section">
                          {iv.what_went_well && (
                            <div className="feedback-block">
                              <div className="feedback-label">✅ What went well</div>
                              <div className="feedback-text">{iv.what_went_well}</div>
                            </div>
                          )}
                          {iv.improvements && (
                            <div className="feedback-block">
                              <div className="feedback-label">📈 Improvements</div>
                              <div className="feedback-text">{iv.improvements}</div>
                            </div>
                          )}
                          {iv.follow_up_actions && (
                            <div className="feedback-block">
                              <div className="feedback-label">🎯 Follow-ups</div>
                              <div className="feedback-text">{iv.follow_up_actions}</div>
                            </div>
                          )}
                          {iv.feedback && (
                            <div className="feedback-block">
                              <div className="feedback-label">📝 Notes</div>
                              <div className="feedback-text">{iv.feedback}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── OFFER TAB ── */}
        {tab === 'offer' && (
          <div>
            <div className="section-header">
              <span className="section-title">Offer Details</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowOfferModal(true)}>
                {offer ? 'Edit Offer' : '+ Record Offer'}
              </button>
            </div>

            {!offer ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <div className="empty-state-icon">💰</div>
                <div className="empty-state-title">No offer recorded</div>
                <div className="empty-state-text">When you receive an offer, record the compensation details here for easy comparison.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="offer-card has-offer">
                  <div className="offer-card-title">Total Compensation</div>
                  {offer.ctc && <div className="offer-ctc">{fmtCurrency(offer.ctc)}</div>}
                  <div className="offer-salary-note">Annual CTC · <StatusBadge status={offer.negotiation_status} /></div>

                  <div className="offer-breakdown" style={{ marginTop: 16 }}>
                    <div className="offer-breakdown-item">
                      <span className="offer-breakdown-label">Base Salary</span>
                      <span className="offer-breakdown-value">{fmtCurrency(offer.base_salary)}</span>
                    </div>
                    <div className="offer-breakdown-item">
                      <span className="offer-breakdown-label">Bonus</span>
                      <span className="offer-breakdown-value">{offer.bonus_percent ? `${offer.bonus_percent}%` : '—'}</span>
                    </div>
                    <div className="offer-breakdown-item">
                      <span className="offer-breakdown-label">Stock / ESOP</span>
                      <span className="offer-breakdown-value">{offer.stock_options || '—'}</span>
                    </div>
                    <div className="offer-breakdown-item">
                      <span className="offer-breakdown-label">Offer Date</span>
                      <span className="offer-breakdown-value">{fmtDate(offer.offer_date)}</span>
                    </div>
                    <div className="offer-breakdown-item">
                      <span className="offer-breakdown-label">Response Deadline</span>
                      <span className="offer-breakdown-value">{fmtDate(offer.response_deadline)}</span>
                    </div>
                  </div>
                </div>

                {offer.benefits && (
                  <div>
                    <div className="detail-section-title">Benefits</div>
                    <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{offer.benefits}</p>
                  </div>
                )}
                {offer.notes && (
                  <div>
                    <div className="detail-section-title">Negotiation Notes</div>
                    <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{offer.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TIMELINE TAB ── */}
        {tab === 'timeline' && (
          <div>
            <div className="section-title" style={{ marginBottom: 16 }}>Activity Log</div>
            {timeline.length === 0 ? (
              <div className="empty-state" style={{ padding: '30px 0' }}>
                <div className="empty-state-text">No events recorded yet.</div>
              </div>
            ) : (
              <div className="event-list">
                {[...timeline].reverse().map(ev => (
                  <div key={ev.id} className="event-item">
                    <div className="event-dot" style={{ background: ev.event_type.includes('rejected') || ev.event_type.includes('failed') ? 'var(--danger)' : ev.event_type.includes('offer') ? 'var(--success)' : 'var(--accent)' }} />
                    <div className="event-text">
                      <div className="event-details">{ev.event_details || ev.event_type.replace(/_/g, ' ')}</div>
                      <div className="event-date">{fmtDate(ev.event_date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sub-modals */}
      {showInterviewModal && (
        <InterviewModal
          jobId={jobId}
          interview={editInterview}
          onClose={() => { setShowInterviewModal(false); setEditInterview(null); }}
          onSaved={() => { setShowInterviewModal(false); setEditInterview(null); fetchAll(); onRefresh(); }}
        />
      )}
      {showOfferModal && (
        <OfferModal
          jobId={jobId}
          offer={offer}
          onClose={() => setShowOfferModal(false)}
          onSaved={() => { setShowOfferModal(false); fetchAll(); onRefresh(); }}
        />
      )}
    </Modal>
  );
}

// ─── DEADLINE ALERTS BANNER ───────────────────────────────────────────────────
function DeadlineAlerts({ onJobClick }) {
  const [deadlines, setDeadlines] = useState([]);

  useEffect(() => {
    api.get('/stats/upcoming-deadlines?days=7')
      .then(r => setDeadlines(r.data))
      .catch(() => {});
  }, []);

  if (deadlines.length === 0) return null;

  return (
    <div className="deadline-alerts">
      {deadlines.map(d => (
        <div
          key={d.id}
          className={`deadline-alert ${d.days_left <= 2 ? 'urgent' : 'soon'}`}
          style={{ cursor: 'pointer' }}
          onClick={() => onJobClick(d.id)}
        >
          <span>⚠️</span>
          <div className="deadline-alert-text">
            <strong>{d.company_name} — {d.position_title}</strong>
            <span>Deadline in {d.days_left === 0 ? 'today' : `${d.days_left} day${d.days_left !== 1 ? 's' : ''}`}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────
function DashboardPage({ user, onOpenMenu }) {
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editJobId, setEditJobId] = useState(null);
  const [detailJobId, setDetailJobId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('updated');

  const fetchAll = useCallback(async () => {
    try {
      const [jR, sR] = await Promise.all([api.get('/jobs'), api.get('/stats')]);
      setJobs(jR.data);
      setStats(sR.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleStar = async (e, id) => {
    e.stopPropagation();
    await api.post(`/jobs/${id}/star`);
    fetchAll();
  };

  const filtered = jobs
    .filter(j => {
      const matchStatus = filter === 'all' || j.status === filter || (filter === 'starred' && j.is_starred);
      const q = search.toLowerCase();
      const matchSearch = !q || j.company_name.toLowerCase().includes(q) || j.position_title.toLowerCase().includes(q) || (j.notes || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'updated') return new Date(b.updated_at) - new Date(a.updated_at);
      if (sortBy === 'applied') return new Date(b.application_date) - new Date(a.application_date);
      if (sortBy === 'company') return a.company_name.localeCompare(b.company_name);
      return 0;
    });

  if (loading) return <LoadingScreen />;

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <button className="mobile-menu-btn" onClick={onOpenMenu}>☰</button>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Welcome back, {user?.full_name?.split(' ')[0]} 👋</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => { setEditJobId(null); setShowAddModal(true); }}>
            + New Application
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        {stats && (
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-value">{stats.total_applications}</div>
              <div className="stat-label">Total Applied</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.status_breakdown.interview}</div>
              <div className="stat-label">In Interview</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.status_breakdown.offer}</div>
              <div className="stat-label">Offers</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.status_breakdown.rejected}</div>
              <div className="stat-label">Rejected</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.response_rate}%</div>
              <div className="stat-label">Response Rate</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.interview_rate}%</div>
              <div className="stat-label">Interview Rate</div>
            </div>
          </div>
        )}

        {/* Deadline Alerts */}
        <DeadlineAlerts onJobClick={(id) => setDetailJobId(id)} />

        {/* Toolbar */}
        <div className="toolbar">
          <div className="search-box">
            <span className="search-box-icon">⌕</span>
            <input
              className="form-input"
              style={{ paddingLeft: 32 }}
              placeholder="Search company, position, notes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All ({jobs.length})</option>
            <option value="starred">⭐ Starred</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>

          <select className="form-select" style={{ width: 'auto', minWidth: 130 }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="updated">Last Updated</option>
            <option value="applied">Applied Date</option>
            <option value="company">Company A–Z</option>
          </select>
        </div>

        {/* Job List */}
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">{jobs.length === 0 ? 'No applications yet' : 'No results'}</div>
            <div className="empty-state-text">
              {jobs.length === 0
                ? 'Start tracking your job applications by clicking "New Application".'
                : 'Try adjusting your search or filter.'}
            </div>
            {jobs.length === 0 && (
              <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add First Application</button>
            )}
          </div>
        ) : (
          <div className="jobs-list">
            {filtered.map(job => (
              <div
                key={job.id}
                className={`job-card status-${job.status}`}
                onClick={() => setDetailJobId(job.id)}
              >
                <div className="job-card-main">
                  <div className="job-card-header">
                    <div className="job-company-logo">{job.company_name[0]}</div>
                    <div className="job-card-titles">
                      <div className="job-position">{job.position_title}</div>
                      <div className="job-company">{job.company_name}</div>
                    </div>
                  </div>

                  <div className="job-card-meta">
                    <span className="job-meta-item"><span className="job-meta-item-icon">📅</span>{fmtDateShort(job.application_date)}</span>
                    {job.location && <span className="job-meta-item"><span className="job-meta-item-icon">📍</span>{job.location}</span>}
                    {job.salary_range && <span className="job-meta-item"><span className="job-meta-item-icon">💰</span>{job.salary_range}</span>}
                  </div>

                  <div className="job-card-badges">
                    <StatusBadge status={job.status} />
                    {job.current_interview_round > 0 && (
                      <span className="interview-round-chip">Round {job.current_interview_round}</span>
                    )}
                    {job.deadline_date && <DeadlineBadge deadline={job.deadline_date} />}
                  </div>
                </div>

                <div className="job-card-actions">
                  <button
                    className={`star-btn ${job.is_starred ? 'starred' : ''}`}
                    onClick={e => handleStar(e, job.id)}
                    title={job.is_starred ? 'Unstar' : 'Star'}
                  >
                    {job.is_starred ? '⭐' : '☆'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11 }}
                    onClick={e => { e.stopPropagation(); setEditJobId(job.id); setShowAddModal(true); }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddJobModal
          jobId={editJobId}
          onClose={() => { setShowAddModal(false); setEditJobId(null); }}
          onSaved={() => { setShowAddModal(false); setEditJobId(null); fetchAll(); }}
        />
      )}

      {detailJobId && (
        <JobDetailModal
          jobId={detailJobId}
          onClose={() => setDetailJobId(null)}
          onRefresh={fetchAll}
          user={user}
        />
      )}
    </>
  );
}

// ─── KANBAN BOARD PAGE ────────────────────────────────────────────────────────
function KanbanPage({ user, onOpenMenu }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailJobId, setDetailJobId] = useState(null);

  const fetchJobs = useCallback(async () => {
    try {
      const { data } = await api.get('/jobs');
      setJobs(data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  if (loading) return <LoadingScreen />;

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <button className="mobile-menu-btn" onClick={onOpenMenu}>☰</button>
          <h1 className="page-title">Pipeline</h1>
          <p className="page-subtitle">Visual view of your application stages</p>
        </div>
      </div>

      <div className="page-body" style={{ overflowX: 'auto' }}>
        <div className="kanban-board">
          {KANBAN_COLUMNS.map(col => {
            const colJobs = jobs.filter(j => j.status === col.key);
            return (
              <div key={col.key} className="kanban-column">
                <div className="kanban-column-header">
                  <div className="kanban-column-title">
                    <div className="kanban-column-dot" style={{ background: col.color }} />
                    {col.label}
                  </div>
                  <span className="kanban-column-count">{colJobs.length}</span>
                </div>

                <div className="kanban-cards">
                  {colJobs.length === 0 && (
                    <div className="kanban-empty">No applications here</div>
                  )}
                  {colJobs.map(job => (
                    <div key={job.id} className="kanban-card" onClick={() => setDetailJobId(job.id)}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <div className="job-company-logo" style={{ width: 28, height: 28, fontSize: 11 }}>{job.company_name[0]}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="kanban-card-title" style={{ fontSize: 13 }}>{job.position_title}</div>
                          <div className="kanban-card-company">{job.company_name}</div>
                        </div>
                        {job.is_starred && <span style={{ fontSize: 12 }}>⭐</span>}
                      </div>

                      <div className="kanban-card-footer">
                        <span className="kanban-card-date">{fmtDateShort(job.application_date)}</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {job.current_interview_round > 0 && (
                            <span className="interview-round-chip" style={{ fontSize: 10 }}>R{job.current_interview_round}</span>
                          )}
                          {job.deadline_date && <DeadlineBadge deadline={job.deadline_date} />}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {detailJobId && (
        <JobDetailModal
          jobId={detailJobId}
          onClose={() => setDetailJobId(null)}
          onRefresh={fetchJobs}
          user={user}
        />
      )}
    </>
  );
}

// ─── ANALYTICS PAGE ───────────────────────────────────────────────────────────
function AnalyticsPage({ onOpenMenu }) {
  const [stats, setStats] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [interviewStats, setInterviewStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/stats'),
      api.get('/stats/funnel'),
      api.get('/stats/timeline'),
      api.get('/stats/interviews'),
    ]).then(([s, f, t, i]) => {
      setStats(s.data);
      setFunnel(f.data.stages);
      setTimeline(t.data.data);
      setInterviewStats(i.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingScreen />;

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <button className="mobile-menu-btn" onClick={onOpenMenu}>☰</button>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Your job search performance at a glance</p>
        </div>
      </div>

      <div className="page-body">
        {/* Summary stats */}
        {stats && (
          <div className="stats-row" style={{ marginBottom: 32 }}>
            <div className="stat-card">
              <div className="stat-value">{stats.total_applications}</div>
              <div className="stat-label">Total Applied</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.response_rate}%</div>
              <div className="stat-label">Response Rate</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.interview_rate}%</div>
              <div className="stat-label">Interview Rate</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.offer_rate}%</div>
              <div className="stat-label">Offer Rate</div>
            </div>
          </div>
        )}

        <div className="analytics-grid">
          {/* Funnel */}
          <div className="analytics-card">
            <div className="analytics-card-title">Application Funnel</div>
            <FunnelChart stages={funnel} />
          </div>

          {/* Activity */}
          <div className="analytics-card">
            <div className="analytics-card-title">Applications — Last 30 Days</div>
            {timeline && timeline.length > 0 ? (
              <ActivityChart data={timeline} />
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data in the last 30 days.</p>
            )}
          </div>

          {/* Status Breakdown */}
          {stats && (
            <div className="analytics-card">
              <div className="analytics-card-title">Status Breakdown</div>
              <table className="offers-table" style={{ marginTop: 0 }}>
                <tbody>
                  {Object.entries(stats.status_breakdown).map(([k, v]) => (
                    <tr key={k}>
                      <td><StatusBadge status={k} /></td>
                      <td style={{ fontWeight: 700, textAlign: 'right' }}>{v}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'right' }}>
                        {stats.total_applications > 0 ? `${((v / stats.total_applications) * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Funnel Stages Detail */}
          {funnel && (
            <div className="analytics-card">
              <div className="analytics-card-title">Conversion Rates</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {funnel.map((s, i) => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{s.count} apps · {s.rate}%</span>
                      </div>
                      <div className="funnel-bar">
                        <div className="funnel-bar-fill" style={{ width: `${s.rate}%`, background: s.color }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interview Performance */}
          {interviewStats && (
            <div className="analytics-card" style={{ gridColumn: 'span 2' }}>
              <div className="analytics-card-title">🎙️ Interview Performance by Company</div>
              {interviewStats.by_company.length === 0 ? (
                <p className="text-secondary" style={{ fontSize: 13 }}>No interview records found. Start scheduling rounds to build stats.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <table className="offers-table" style={{ marginTop: 0 }}>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th style={{ textAlign: 'center' }}>Rounds</th>
                        <th style={{ textAlign: 'center' }}>Avg Difficulty</th>
                        <th style={{ textAlign: 'center' }}>Avg Performance</th>
                        <th>Status Distribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interviewStats.by_company.map(c => (
                        <tr key={c.company_name}>
                          <td style={{ fontWeight: 700 }}>{c.company_name}</td>
                          <td style={{ textAlign: 'center' }}>{c.total_rounds}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ fontWeight: 600 }}>{c.avg_difficulty || '—'}</span>
                            {c.avg_difficulty > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> / 5</span>}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ fontWeight: 600, color: c.avg_performance >= 3.5 ? 'var(--status-offer-text)' : c.avg_performance >= 2.5 ? 'var(--status-interview-text)' : 'var(--danger)' }}>
                              {c.avg_performance || '—'}
                            </span>
                            {c.avg_performance > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> / 5</span>}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {Object.entries(c.outcomes).map(([status, count]) => count > 0 && (
                                <span key={status} className={`status-badge ${status}`} style={{ fontSize: 10, padding: '1px 6px' }}>
                                  {status}: {count}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {interviewStats.improvement_areas.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>🎯 Focus & Improvement Suggestions</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {interviewStats.improvement_areas.map(area => (
                          <div key={area.round_type} style={{ padding: 12, background: 'var(--danger-light)', borderLeft: '3px solid var(--danger)', borderRadius: 6, fontSize: 12.5, color: 'var(--text-primary)' }}>
                            <strong>{area.type_label}:</strong> {area.reason}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
function SettingsPage({ user, updateUser, logout, theme, toggleTheme, onOpenMenu }) {
  const [name, setName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [resumeText, setResumeText] = useState(user?.resume_text || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg(''); setError('');
    try {
      const payload = { full_name: name, email, resume_text: resumeText };
      if (password) payload.password = password;
      const { data } = await api.put('/auth/me', payload);
      updateUser({ full_name: data.full_name, email: data.email, resume_text: data.resume_text });
      setMsg('Profile updated successfully!');
      setPassword('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update profile.');
    }
  };

  const handleResumeUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setSaving(true);
    setMsg('');
    setError('');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const { data } = await api.post('/auth/resume/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      setResumeText(data.resume_text);
      updateUser({ resume_text: data.resume_text });
      setMsg('Resume file uploaded and parsed successfully!');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to parse and upload resume file.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <button className="mobile-menu-btn" onClick={onOpenMenu}>☰</button>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your profile and preferences</p>
        </div>
      </div>

      <div className="page-body">
        <div className="settings-layout">

          {/* Profile */}
          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-title">Profile</div>
            </div>
            <form onSubmit={handleSaveProfile}>
              <div className="settings-card-body">
                <div className="form-field">
                  <label className="form-label">Full Name</label>
                  <input className="form-input" value={name} onChange={e => setName(e.target.value)} required />
                </div>
                <div className="form-field">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                <div className="form-field">
                  <label className="form-label">New Password (leave blank to keep current)</label>
                  <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" minLength={8} />
                </div>
                <div className="form-field">
                  <label className="form-label">Upload Resume File (PDF or TXT)</label>
                  <input
                    type="file"
                    accept=".pdf,.txt,.md"
                    onChange={handleResumeUpload}
                    className="form-input"
                    style={{ padding: '8px 12px' }}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Resume / CV Skills & Text (for Match Scoring)</label>
                  <textarea className="form-textarea" rows={6} value={resumeText} onChange={e => setResumeText(e.target.value)} placeholder="Paste your resume skills list, experience details, or raw text here…" />
                </div>
                {msg && <div style={{ color: 'var(--success)', fontSize: 13, padding: '8px 12px', background: 'var(--success-light)', borderRadius: 8 }}>✓ {msg}</div>}
                {error && <div className="auth-error">{error}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save Profile'}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Preferences */}
          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-title">Preferences</div>
            </div>
            <div className="settings-card-body">
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Dark Mode</span>
                  <small>Switch between dark and light themes</small>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={theme === 'dark'} onChange={toggleTheme} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <hr className="divider" />

              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Email Notifications</span>
                  <small>Get alerts for interviews & upcoming deadlines in your inbox</small>
                </div>
                <span className="status-badge completed" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>Active</span>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-title" style={{ color: 'var(--danger)' }}>Account</div>
            </div>
            <div className="settings-card-body">
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Log Out</span>
                  <small>Sign out of your account</small>
                </div>
                <button className="btn btn-danger btn-sm" onClick={logout}>Log Out</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ─── AUTH PAGES ───────────────────────────────────────────────────────────────
function LoginPage({ auth }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try { await auth.login(email, password); }
    catch (err) { setError(err.response?.data?.detail || 'Login failed.'); }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">A</div>
          <span className="auth-logo-text">Applync</span>
        </div>
        <h1 className="auth-heading">Welcome back</h1>
        <p className="auth-subheading">Sign in to your job application tracker</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input id="login-email" className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="form-field">
            <label className="form-label">Password</label>
            <input id="login-password" className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button id="login-submit" type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="auth-switch">
          Don't have an account? <a href="/register">Create one</a>
        </p>
      </div>
    </div>
  );
}

function RegisterPage({ auth }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true); setError('');
    try { await auth.register(email, password, name); }
    catch (err) { setError(err.response?.data?.detail || 'Registration failed.'); }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">A</div>
          <span className="auth-logo-text">Applync</span>
        </div>
        <h1 className="auth-heading">Create account</h1>
        <p className="auth-subheading">Start tracking your job applications</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Full Name</label>
            <input id="reg-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Muskan Kumari" required />
          </div>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input id="reg-email" className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="form-field">
            <label className="form-label">Password (min 8 chars)</label>
            <input id="reg-password" className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" minLength={8} required />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button id="reg-submit" type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </div>
    </div>
  );
}

// ─── MAIN APP SHELL ───────────────────────────────────────────────────────────
function AppShell({ auth }) {
  const [page, setPage] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme(auth.user, auth.updateUser);

  const renderPage = () => {
    switch (page) {
      case 'kanban':    return <KanbanPage user={auth.user} onOpenMenu={() => setSidebarOpen(true)} />;
      case 'analytics': return <AnalyticsPage onOpenMenu={() => setSidebarOpen(true)} />;
      case 'settings':  return <SettingsPage user={auth.user} updateUser={auth.updateUser} logout={auth.logout} theme={theme} toggleTheme={toggleTheme} onOpenMenu={() => setSidebarOpen(true)} />;
      default:          return <DashboardPage user={auth.user} onOpenMenu={() => setSidebarOpen(true)} />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar
        user={auth.user}
        onLogout={auth.logout}
        currentPage={page}
        onNavigate={setPage}
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const auth = useAuth();

  if (auth.loading) return <LoadingScreen />;

  return (
    <Router>
      <Routes>
        <Route path="/login"    element={auth.user ? <Navigate to="/" /> : <LoginPage auth={auth} />} />
        <Route path="/register" element={auth.user ? <Navigate to="/" /> : <RegisterPage auth={auth} />} />
        <Route path="/*"        element={auth.user ? <AppShell auth={auth} /> : <Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}
