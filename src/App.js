import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import HomePage from './HomePage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import AuthCallback from './pages/AuthCallback';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import OAuthConsent from './pages/OAuthConsent';
import InvitationAccept from './pages/InvitationAccept';
import AppLayout from './app/AppLayout';
import Overview from './app/views/Overview';
import BuildSkill from './app/views/BuildSkill';
import SkillsList from './app/views/SkillsList';
import SkillDetail from './app/views/SkillDetail';
import ReviewQueue from './app/views/ReviewQueue';
import Interviews from './app/views/Interviews';
import InterviewChat from './app/views/InterviewChat';
import Capture from './app/views/Capture';
import Connectors from './app/views/Connectors';
import Executions from './app/views/Executions';
import Onboarding from './app/views/Onboarding';
import AgentConnections from './app/views/AgentConnections';
import PrivacySettings from './app/views/PrivacySettings';
import { AuthProvider } from './app/AuthProvider';
import { useAuth } from './app/auth';
import { safeReturnTo, withReturnTo } from './lib/returnTo';

export function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="login"><p className="login-notice" role="status">Restoring your secure session…</p></div>;
  if (!session) {
    const returnTo = safeReturnTo(`${location.pathname}${location.search}`);
    return <Navigate to={withReturnTo('/login', returnTo)} replace />;
  }
  return children;
}

function RouteMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const titles = {
      '/': 'Brian - Your Company Brain',
      '/login': 'Log in | Brian',
      '/signup': 'Create your Brian account',
      '/forgot-password': 'Reset password | Brian',
      '/reset-password': 'Choose a new password | Brian',
      '/auth/callback': 'Finishing sign in | Brian',
      '/oauth/consent': 'Authorize agent | Brian',
      '/onboarding': 'Set up Brian',
      '/app/settings/agents': 'Agents & connections | Brian',
      '/app/settings/privacy': 'Privacy & deletion | Brian',
    };
    document.title = titles[pathname] || (pathname.startsWith('/app') ? 'Brian App' : 'Brian');

    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }
    robots.setAttribute('content', pathname === '/' ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' : 'noindex,nofollow');
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RouteMeta />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/oauth/consent" element={<OAuthConsent />} />
          <Route path="/invite/:token" element={<InvitationAccept />} />
          <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<Overview />} />
            <Route path="build" element={<BuildSkill />} />
            <Route path="skills" element={<SkillsList />} />
            <Route path="skills/:id" element={<SkillDetail />} />
            <Route path="review" element={<ReviewQueue />} />
            <Route path="interviews" element={<Interviews />} />
            <Route path="interviews/:id" element={<InterviewChat />} />
            <Route path="capture" element={<Capture />} />
            <Route path="connectors" element={<Connectors />} />
            <Route path="executions" element={<Executions />} />
            <Route path="settings/agents" element={<AgentConnections />} />
            <Route path="settings/privacy" element={<PrivacySettings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
