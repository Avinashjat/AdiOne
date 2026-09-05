import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBanner, Field, Icon, inputClass } from '@/components/ui';

/**
 * Storefront illustration.
 *
 * Drawn inline as SVG rather than shipped as a PNG: it is flat colour, it has
 * to stay crisp on a counter tablet, and it costs about 2 KB this way.
 */
function StorefrontArt() {
  return (
    <svg viewBox="0 0 400 300" className="h-auto w-full max-w-md" role="img" aria-label="">
      {/* skyline */}
      <g fill="#DCF0E1">
        <rect x="20" y="120" width="46" height="120" rx="4" />
        <rect x="330" y="140" width="44" height="100" rx="4" />
        <rect x="286" y="100" width="34" height="140" rx="4" />
      </g>
      <g fill="#B6E1C1" opacity="0.7">
        <circle cx="70" cy="60" r="18" />
        <circle cx="92" cy="60" r="24" />
        <circle cx="118" cy="60" r="16" />
        <circle cx="300" cy="45" r="14" />
        <circle cx="318" cy="45" r="19" />
      </g>

      {/* shop body */}
      <rect x="96" y="120" width="208" height="120" rx="8" fill="#F1F9F3" />
      <rect x="96" y="120" width="208" height="120" rx="8" fill="none" stroke="#B6E1C1" strokeWidth="2" />

      {/* sign */}
      <rect x="128" y="92" width="144" height="38" rx="8" fill="#1E8E3E" />
      <text
        x="200"
        y="118"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="22"
        fontWeight="700"
        fontFamily="Inter, system-ui, sans-serif"
      >
        AdiOne
      </text>

      {/* awning */}
      <g>
        <path d="M92 138h216l-10 26H102z" fill="#FFFFFF" />
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <path
            key={index}
            d={`M${104 + index * 36} 138h18l-8 26h-18z`}
            fill="#4FB06C"
          />
        ))}
        <path d="M92 138h216l-10 26H102z" fill="none" stroke="#B6E1C1" strokeWidth="2" />
      </g>

      {/* windows and door */}
      <rect x="118" y="176" width="62" height="50" rx="4" fill="#FFFFFF" stroke="#B6E1C1" strokeWidth="2" />
      <rect x="222" y="176" width="62" height="64" rx="4" fill="#DCF0E1" stroke="#B6E1C1" strokeWidth="2" />

      {/* basket */}
      <g>
        <path d="M44 216h58l-7 34a6 6 0 0 1-6 5H57a6 6 0 0 1-6-5z" fill="#1E8E3E" />
        <rect x="38" y="208" width="70" height="10" rx="5" fill="#17762F" />
        <path d="M62 208c0-12 6-20 11-24" stroke="#4FB06C" strokeWidth="4" fill="none" strokeLinecap="round" />
        <ellipse cx="86" cy="200" rx="11" ry="9" fill="#E5484D" />
        <path d="M60 186c6-10 14-14 20-14-2 10-8 16-16 18z" fill="#4FB06C" />
        <rect x="70" y="182" width="12" height="26" rx="5" fill="#FFFFFF" opacity="0.9" />
      </g>

      {/* shrubs */}
      <circle cx="330" cy="228" r="18" fill="#4FB06C" opacity="0.55" />
      <circle cx="352" cy="234" r="13" fill="#4FB06C" opacity="0.4" />
      <rect x="20" y="240" width="360" height="4" rx="2" fill="#B6E1C1" />
    </svg>
  );
}

const TRUST = [
  { icon: 'shield', line1: 'Secure', line2: 'Access' },
  { icon: 'clock', line1: 'Manage Store', line2: 'Easily' },
  { icon: 'headset', line1: '24/7', line2: 'Support' },
] as const;

export default function LoginPage() {
  const login = useAuth((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      // The server returns one identical message for every failure mode, so
      // this endpoint cannot be used to discover which staff emails exist.
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-0 sm:p-6 lg:p-10">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl overflow-hidden bg-white sm:min-h-0 sm:rounded-3xl sm:shadow-xl lg:grid-cols-2">
        {/* ---- brand panel ------------------------------------------------ */}
        <div className="relative hidden flex-col justify-between bg-brand-50 p-10 lg:flex">
          <div>
            <p className="text-4xl font-bold leading-none">
              <span className="text-gray-900">Adi</span>
              <span className="text-brand-500">One</span>
            </p>
            <p className="mt-1.5 text-sm font-medium text-gray-600">Admin Panel</p>

            <h2 className="mt-14 text-4xl font-bold leading-tight text-gray-900">
              Welcome Back!
            </h2>
            <p className="mt-3 max-w-sm text-base text-gray-600">
              Sign in to manage your store, orders, products and more.
            </p>
          </div>

          <div className="flex justify-center py-8">
            <StorefrontArt />
          </div>

          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} AdiOne. All rights reserved.
          </p>
        </div>

        {/* ---- form ------------------------------------------------------- */}
        <div className="flex items-center justify-center p-6 sm:p-10 lg:p-14">
          <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
            {/* The brand panel is hidden on small screens, so the mark repeats
                here rather than leaving a bare form. */}
            <div className="lg:hidden">
              <p className="text-3xl font-bold leading-none">
                <span className="text-gray-900">Adi</span>
                <span className="text-brand-500">One</span>
              </p>
              <p className="mt-1 text-sm font-medium text-gray-500">Admin Panel</p>
            </div>

            <div>
              <h1 className="text-3xl font-bold text-gray-900">Sign In</h1>
              <p className="mt-1.5 text-sm text-gray-500">
                Enter your email and password to continue
              </p>
            </div>

            <ErrorBanner message={error} />

            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
                placeholder="you@adione.in"
                autoComplete="username"
                autoFocus
                required
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </Field>

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>

            <div className="border-t border-gray-200 pt-6">
              <div className="grid grid-cols-3 divide-x divide-gray-200">
                {TRUST.map((item) => (
                  <div key={item.line1} className="flex items-center justify-center gap-2 px-1">
                    <span className="text-brand-500">
                      <Icon name={item.icon} />
                    </span>
                    <span className="text-xs font-medium leading-tight text-gray-600">
                      {item.line1}
                      <br />
                      {item.line2}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
