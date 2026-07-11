import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import HomePage from './HomePage';
import Login from './pages/Login';
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
import { isLoggedIn } from './app/auth';

function RequireAuth({ children }) {
  return isLoggedIn() ? children : <Navigate to="/login" replace />;
}

function RouteMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const isPublicHome = pathname === '/';
    document.title = isPublicHome
      ? 'Brian - Your Company Brain'
      : pathname === '/login'
        ? 'Log in | Brian'
        : 'Brian App';

    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }
    robots.setAttribute(
      'content',
      isPublicHome
        ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
        : 'noindex,nofollow'
    );
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteMeta />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
