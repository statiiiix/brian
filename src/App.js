import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './HomePage';
import Login from './pages/Login';
import AppLayout from './app/AppLayout';
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

export default function App() {
  return (
    <BrowserRouter>
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
          <Route index element={<Navigate to="skills" replace />} />
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
