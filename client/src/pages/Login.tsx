import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';

interface DemoUser {
  username: string;
  password: string;
  role: string;
}

const DEMO_USERS: DemoUser[] = [
  { username: 'admin', password: 'admin123', role: 'Plant Administrator' },
  { username: 'manager', password: 'manager123', role: 'Operations Manager' },
  { username: 'maintenance', password: 'maintenance123', role: 'Maintenance Staff' },
  { username: 'user', password: 'user123', role: 'Shop User' },
];

const FEATURES = [
  ['box', 'Inventory control', 'Live stock, movements, reorder alerts'],
  ['wrench', 'Maintenance', 'Work orders, schedules, spare parts'],
  ['factory', 'Production', 'Output, scrap, delivery tracking'],
  ['cart', 'Purchasing', 'Supplier orders and receiving'],
];

export default function Login() {
  const { login, notice, setNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setSigningIn(true);
    setError('');
    setNotice('');
    try {
      await login(username.trim(), password);
      const target = location.pathname && location.pathname !== '/' ? location.pathname : '/dashboard';
      navigate(target, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to sign in.');
      setSigningIn(false);
    }
  };

  const fillDemo = (demo: DemoUser) => {
    setUsername(demo.username);
    setPassword(demo.password);
    setError('');
    setNotice('');
  };

  return (
    <div className="login-screen">
      <section className="login-brand">
        <div className="login-logo">
          <div className="login-logo-mark">M</div>
          <div>
            <div className="login-logo-name">Makoto Metal Technology, Inc.</div>
            <div className="login-logo-sub">MEPZ II · Lapu-Lapu City</div>
          </div>
        </div>
        <div className="login-hero">
          <span className="login-eyebrow">
            <Icon name="shield" size={13} /> Internal operations system
          </span>
          <h1>
            Every part, machine, and order <em>in one place.</em>
          </h1>
          <p>
            Inventory, preventive maintenance, production output, and purchasing for the die-casting,
            machining, and welding operations at MEPZ II.
          </p>
        </div>
        <div className="login-features">
          {FEATURES.map(([icon, title, text]) => (
            <div className="login-feature" key={title}>
              <Icon name={icon} size={17} />
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="login-footer">Makoto Metal Technology, Inc. · Internal use only · 2026</div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <span className="badge badge-soft no-dot">MEPZ II operations console</span>
          <h2>Sign in</h2>
          <p>Use your company account to open the operations console.</p>
          <div className={`login-error ${error ? 'show' : ''}`}>{error}</div>
          {!error && notice ? (
            <div className="info-banner" style={{ marginBottom: 16 }}>
              <Icon name="info" size={16} />
              <div>{notice}</div>
            </div>
          ) : null}
          <form className="login-form" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="login-username">Username</label>
              <input
                className="input"
                id="login-username"
                type="text"
                autoComplete="username"
                required
                autoFocus
                placeholder="e.g. admin"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input
                className="input"
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <button className="btn btn-primary login-submit" type="submit" disabled={signingIn}>
              <Icon name="lock" size={15} /> {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="login-demo">
            <div className="login-demo-title">Demo accounts</div>
            <div className="demo-chips">
              {DEMO_USERS.map((demo) => (
                <button
                  key={demo.username}
                  className="demo-chip"
                  type="button"
                  onClick={() => fillDemo(demo)}
                >
                  {demo.role} · {demo.username}
                </button>
              ))}
            </div>
          </div>
          <div className="login-note">
            <Icon name="info" size={15} />
            <span>
              Demo environment. Accounts are seeded for evaluation; change the administrator password
              before real use.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
